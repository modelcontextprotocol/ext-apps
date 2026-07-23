import type { Page } from "playwright";
import { BrowserHost, Runner, type SubtestResult } from "./index";

//#region BrowserHost_subclass
// Subclass BrowserHost for the host you want to test. Fill in the three hooks for
// YOUR product's UI; everything else (launch, the bridge, real clicks, per-test
// isolation) is shared. The conformance app must already be connected to the host.
export class MyHost extends BrowserHost {
  readonly name = "my-host";
  // The host web app the conformance connector is connected to.
  readonly url = "https://my-host.example/";
  // A selector matching the rendered conformance-app iframe in the host DOM.
  readonly widgetSelector = 'iframe[src*="conformance"]';

  // Enter a prompt that makes the host render the connected conformance app.
  protected async sendPrompt(page: Page, appName: string): Promise<void> {
    await page.fill("#composer", `run ${appName}`);
    await page.keyboard.press("Enter");
  }

  // Dismiss cookie/onboarding modals if your host shows them (no-op otherwise).
  protected async dismissModal(_page: Page): Promise<void> {}

  // Return true once `marker` appears in the host conversation.
  protected async verifyConversation(
    page: Page,
    marker: string,
    _timeoutMs: number,
  ): Promise<boolean> {
    return (await page.textContent("body"))?.includes(marker) ?? false;
  }
}
//#endregion BrowserHost_subclass

//#region conformance_runSuite
export async function runConformance(): Promise<SubtestResult[]> {
  const host = new MyHost();
  const runner = new Runner(host, {
    appName: "Conformance",
    profileDir: ".profile", // persist login across runs
  });
  const results = await runner.run();
  for (const r of results) {
    const detail = r.message ? ` — ${r.message}` : "";
    console.log(`${r.status.padEnd(7)} ${r.id}${detail}`);
  }
  return results;
}
//#endregion conformance_runSuite

export {};
