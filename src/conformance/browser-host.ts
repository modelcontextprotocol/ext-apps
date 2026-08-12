import type { BrowserContext, Frame, Page } from "playwright";
import { chromium } from "playwright";
import type { Host, SetupOptions, SuiteBridge } from "./host";
import type { CapabilityResult } from "./protocol";
import { CHANNEL } from "./protocol";
import { CLICK_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, sleep } from "./util";

/**
 * Reusable Playwright plumbing for a browser-based host. A host subclasses this
 * and implements the three product-specific hooks ({@link BrowserHost.sendPrompt},
 * {@link BrowserHost.dismissModal}, {@link BrowserHost.verifyConversation}, plus an
 * optional {@link BrowserHost.commitMessage}); everything else — launch, the
 * SuiteBridge over `frame.evaluate`, real cross-origin clicks, dialog handling,
 * per-test isolation — is shared. The conformance app must already be connected
 * to the target host.
 *
 * @example
 * ```ts source="./index.examples.ts#BrowserHost_subclass"
 * // Subclass BrowserHost for the host you want to test. Fill in the three hooks for
 * // YOUR product's UI; everything else (launch, the bridge, real clicks, per-test
 * // isolation) is shared. The conformance app must already be connected to the host.
 * export class MyHost extends BrowserHost {
 *   readonly name = "my-host";
 *   // The host web app the conformance connector is connected to.
 *   readonly url = "https://my-host.example/";
 *   // A selector matching the rendered conformance-app iframe in the host DOM.
 *   readonly widgetSelector = 'iframe[src*="conformance"]';
 *
 *   // Enter a prompt that makes the host render the connected conformance app.
 *   protected async sendPrompt(page: Page, appName: string): Promise<void> {
 *     await page.fill("#composer", `run ${appName}`);
 *     await page.keyboard.press("Enter");
 *   }
 *
 *   // Dismiss cookie/onboarding modals if your host shows them (no-op otherwise).
 *   protected async dismissModal(_page: Page): Promise<void> {}
 *
 *   // Return true once `marker` appears in the host conversation.
 *   protected async verifyConversation(
 *     page: Page,
 *     marker: string,
 *     _timeoutMs: number,
 *   ): Promise<boolean> {
 *     return (await page.textContent("body"))?.includes(marker) ?? false;
 *   }
 * }
 *
 * ```
 */
export abstract class BrowserHost implements Host {
  abstract readonly name: string;
  /** The URL of the host web app the conformance connector is connected to. */
  abstract readonly url: string;
  /** A selector that matches the rendered conformance-app iframe in the host DOM. */
  abstract readonly widgetSelector: string;

  private context!: BrowserContext;
  private page!: Page;
  private recordVideoDir?: string;
  private consoleLines: string[] = [];

  /** Enter a prompt in the host that makes it render the conformance app. */
  protected abstract sendPrompt(page: Page, appName: string): Promise<void>;
  /** Dismiss any host chrome (cookie/onboarding modals) that blocks the composer. */
  protected abstract dismissModal(page: Page): Promise<void>;
  /** Return true once `marker` appears in the host conversation, within `timeoutMs`. */
  protected abstract verifyConversation(
    page: Page,
    marker: string,
    timeoutMs: number,
  ): Promise<boolean>;
  /** Hosts that draft a ui/message into the composer override this to send it. */
  protected commitMessage?(page: Page): Promise<void>;

  async setup(opts: SetupOptions): Promise<SuiteBridge> {
    this.recordVideoDir = opts.recordVideoDir;
    await this.launch(opts.profileDir);
    await this.page.goto(this.url, { timeout: PAGE_LOAD_TIMEOUT_MS });
    await sleep(5_000); // SPA hydration
    await this.dismissModal(this.page);
    await this.sendPrompt(this.page, opts.appName);
    await this.waitForWidget();
    await sleep(8_000); // app init handshake
    return this.bridge();
  }

  async teardown(): Promise<void> {
    if (this.context) await this.context.close(); // finalizes the video
  }

  async clickTrigger(req: {
    commitDraftedMessage?: boolean;
  }): Promise<CapabilityResult> {
    const ok = await this.realClickTestId("conformance-trigger");
    if (req.commitDraftedMessage && this.commitMessage) {
      await this.commitMessage(this.page);
    }
    return { ok };
  }

  async confirmDialog(
    dialog: "download" | "sampling",
  ): Promise<CapabilityResult> {
    const label = { download: "Download", sampling: "Allow" }[dialog];
    return { ok: await this.clickTopPageButton(label) };
  }

  // Success is the specific link OPENING, not a dialog: some hosts open directly
  // with no prompt, others first show an "Open link" consent. app.openLink already
  // fired (clickTrigger) from inside the iframe, so the tab may already be open;
  // if not, accept a consent dialog and wait for it. We match THIS url (not just
  // any new tab) so an unrelated tab can't pass. resetBetweenTests closes it.
  async checkLinkOpen(url: string): Promise<CapabilityResult> {
    const target = url.replace(/\/+$/, "");
    const isTargetTab = () =>
      this.context
        .pages()
        .some(
          (p) =>
            p !== this.page &&
            !p.isClosed() &&
            p.url().replace(/\/+$/, "").startsWith(target),
        );
    if (isTargetTab()) return { ok: true };
    await this.clickTopPageButton("Open link", 8);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (isTargetTab()) return { ok: true };
      await sleep(500);
    }
    return { ok: false };
  }

  // Read the host page's <iframe> elements — their attributes are readable even
  // though the frames' content is cross-origin.
  async inspectFrame(): Promise<CapabilityResult> {
    const value = await this.page.evaluate(() => {
      const d = (globalThis as any).document;
      const frames = Array.from(d.querySelectorAll("iframe")) as any[];
      const sandboxed = frames.filter((f) => f.hasAttribute("sandbox"));
      return {
        total: frames.length,
        sandboxed: sandboxed.length,
        firstSandbox: sandboxed[0]?.getAttribute("sandbox") ?? null,
      };
    });
    return { ok: true, value };
  }

  // Scan the buffered host console (captured since launch) for `pattern`.
  async readConsole(
    pattern: string,
    timeoutMs: number,
  ): Promise<CapabilityResult> {
    const re = new RegExp(pattern, "i");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.consoleLines.find((l) => re.test(l));
      if (hit) return { ok: true, value: hit };
      if (Date.now() >= deadline) return { ok: false };
      await sleep(500);
    }
  }

  async conversationContains(
    marker: string,
    timeoutMs: number,
  ): Promise<CapabilityResult> {
    return { ok: await this.verifyConversation(this.page, marker, timeoutMs) };
  }

  async toggleTheme(to: "light" | "dark"): Promise<CapabilityResult> {
    await this.page.emulateMedia({ colorScheme: to });
    return { ok: true };
  }

  async resetBetweenTests(): Promise<void> {
    await this.page.bringToFront();
    await this.clearHostOverlay();
    // A real click reverts the display mode to inline; hosts gate display-mode
    // changes on a user gesture, so a programmatic reset alone won't work.
    await this.realClickTestId("reset-inline");
    await this.page.emulateMedia({ colorScheme: "light" }); // deterministic start theme
  }

  // headless MUST stay off: headless Chromium drops cross-origin MessagePort
  // transfers, which breaks the ext-apps init handshake.
  private async launch(profileDir: string): Promise<void> {
    this.context = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: false,
      viewport: null, // let the page track the real OS window (scroll/resize/login)
      args: [
        "--disable-blink-features=AutomationControlled", // navigator.webdriver trips bot checks
        "--disable-popup-blocking",
        "--window-size=1440,1000",
      ],
      recordVideo: this.recordVideoDir
        ? { dir: this.recordVideoDir, size: { width: 1280, height: 720 } }
        : undefined,
    });
    const pages = this.context.pages();
    this.page = pages.length ? pages[0] : await this.context.newPage();
    this.page.on("console", (m) => this.consoleLines.push(m.text()));
  }

  private bridge(): SuiteBridge {
    return {
      listTests: async () => {
        const frame = await this.appFrame();
        return frame.evaluate((k) => globalThis[k]!.listTests(), CHANNEL);
      },
      start: async (filter) => {
        const frame = await this.appFrame();
        await frame.evaluate(([k, f]) => globalThis[k]?.start(f), [
          CHANNEL,
          filter ?? null,
        ] as [typeof CHANNEL, { manual?: boolean; id?: string } | null]);
      },
      poll: async () => {
        const frame = await this.appFrame();
        return frame.evaluate((k) => globalThis[k]!.poll(), CHANNEL);
      },
      resolve: async (result) => {
        const frame = await this.appFrame();
        await frame.evaluate(([k, r]) => globalThis[k]!.resolve(r), [
          CHANNEL,
          result,
        ] as [typeof CHANNEL, CapabilityResult]);
      },
    };
  }

  // The frame running the in-iframe suite (the one that set window[CHANNEL]).
  // Scanning all frames finds it at any nesting depth — the widget-iframe
  // selector alone can miss it (deeper nesting, multiple matching iframes).
  private async appFrame(): Promise<Frame> {
    for (const frame of this.page.frames()) {
      if (frame === this.page.mainFrame()) continue;
      try {
        if (await frame.evaluate((k) => Boolean(globalThis[k]), CHANNEL)) {
          return frame;
        }
      } catch {}
    }
    throw new Error(`app frame not found (no window[${CHANNEL}])`);
  }

  // Real, trusted cross-origin click on a widget button by data-testid.
  // Gesture-gated effects only fire under a genuine click, so this — not
  // postMessage — drives the triggers.
  private async realClickTestId(testid: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Prefer the frame with a pending interaction (the live app instance) so
      // we don't click a stale/detached frame left by a fullscreen remount.
      const frames = this.page
        .frames()
        .filter((f) => f !== this.page.mainFrame());
      const scored: Array<[Frame, boolean]> = [];
      for (const frame of frames)
        scored.push([frame, await this.frameIsLiveApp(frame)]);
      scored.sort((a, b) => Number(b[1]) - Number(a[1]));
      for (const [frame] of scored) {
        try {
          const btn = frame.getByTestId(testid);
          if (await btn.count()) {
            await btn.first().click({ timeout: CLICK_TIMEOUT_MS });
            return true;
          }
        } catch {}
      }
      await sleep(1_000); // a remounting frame; rescan
    }
    return false;
  }

  // True if this frame is the app instance with a pending interaction — the
  // live suite showing the scrim, not a stale/duplicate frame from a remount.
  private async frameIsLiveApp(frame: Frame): Promise<boolean> {
    try {
      return await frame.evaluate((k) => {
        const s = globalThis[k]?.poll();
        return Boolean(s && s.state === "running" && s.request);
      }, CHANNEL);
    } catch {
      return false;
    }
  }

  // Click a control by exact text in a host permission dialog. Role varies:
  // some hosts render "Open link" as a <button>, others as an <a> — match either.
  protected async clickTopPageButton(
    label: string,
    timeoutSeconds = 20,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutSeconds * 1_000;
    while (Date.now() < deadline) {
      const candidates = [
        this.page.getByRole("button", { name: label, exact: true }),
        this.page.getByRole("link", { name: label, exact: true }),
        this.page.getByText(label, { exact: true }),
      ];
      for (const loc of candidates) {
        try {
          if (await loc.count()) {
            await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
            return true;
          }
        } catch {}
      }
      await sleep(1_000);
    }
    return false;
  }

  // Leave a clean page for the next test: a prior test's host dialog leaves a
  // backdrop that intercepts the next trigger click, and open-link opens a new
  // tab. Close stray tabs and Escape any lingering modal.
  private async clearHostOverlay(): Promise<void> {
    for (const p of this.context.pages()) {
      if (p !== this.page && !p.isClosed()) {
        try {
          await p.close();
        } catch {
          /* already gone */
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      let present: boolean;
      try {
        present = await this.page.evaluate(() =>
          Boolean(
            (globalThis as any).document.querySelector(
              "[role=dialog],[aria-modal=true]",
            ),
          ),
        );
      } catch {
        return;
      }
      if (!present) return;
      try {
        await this.page.keyboard.press("Escape");
      } catch {
        return;
      }
      await sleep(600);
    }
  }

  private async waitForWidget(
    timeoutSeconds = 90,
    pollMs = 3_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1_000;
    while (Date.now() < deadline) {
      if (await this.page.locator(this.widgetSelector).count()) return;
      await sleep(pollMs);
    }
    throw new Error(`widget iframe did not appear within ${timeoutSeconds}s`);
  }

  // Poll a browser-side predicate that returns "found" once the marker lands.
  // The host snapshot can lag the dispatched turn by tens of seconds.
  protected async pollMarker(
    page: Page,
    fn: (marker: string) => string | Promise<string>,
    marker: string,
    timeoutMs: number,
    pollMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let status: string;
      try {
        status = (await page.evaluate(fn, marker)) as string;
      } catch (err) {
        status = `error: ${err}`;
      }
      if (status === "found") return true;
      await sleep(pollMs);
    }
    return false;
  }
}
