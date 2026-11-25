/**
 * Tests for the state that `useViewState` starts with.
 *
 * These render with `react-dom/server`, which needs no DOM. It does not run
 * effects, so saving (the debounce, failed saves, changes made before the app
 * is connected, the flush on unmount) is NOT covered here; that needs a DOM
 * test environment, which this repo does not have.
 */
import { describe, expect, it } from "bun:test";
import { useState } from "react";
import { renderToString } from "react-dom/server";

import type { App } from "../app.js";
import type { McpUiHostCapabilities, McpUiHostContext } from "../types.js";
import { useViewState } from "./useViewState.js";

type Draft = { version: 1; text: string };
const INITIAL: Draft = { version: 1, text: "initial" };

function fakeApp(
  hostContext: McpUiHostContext | undefined,
  hostCapabilities: McpUiHostCapabilities = { viewState: { maxBytes: 65536 } },
) {
  const app = {
    getHostContext: () => hostContext,
    getHostCapabilities: () => hostCapabilities,
  } as unknown as App;
  return { app };
}

/** The state that a component using the hook shows on its first render. */
function firstRender(app: App | null): Draft {
  let seen: Draft | undefined;
  function Probe() {
    [seen] = useViewState(app, INITIAL);
    return null;
  }
  renderToString(<Probe />);
  return seen!;
}

describe("useViewState, starting state", () => {
  it("is the initial state while the app is not connected", () => {
    expect(firstRender(null)).toBe(INITIAL);
  });

  it("is the state the host saved, when the app is already connected", () => {
    const saved: Draft = { version: 1, text: "saved" };
    const { app } = fakeApp({ viewState: saved });

    expect(firstRender(app)).toEqual(saved);
  });

  it("is the initial state when the host has nothing saved", () => {
    const { app } = fakeApp({ viewState: null });

    expect(firstRender(app)).toBe(INITIAL);
  });

  it("is the initial state when the host does not save view state", () => {
    const { app } = fakeApp({ theme: "dark" }, {});

    expect(firstRender(app)).toBe(INITIAL);
  });

  it("becomes the saved state when the app connects after the first render", () => {
    const saved: Draft = { version: 1, text: "saved" };
    const { app } = fakeApp({ viewState: saved });
    const seen: Draft[] = [];
    function Probe() {
      // Stands in for `useApp`, which returns null and then the app.
      const [connected, setConnected] = useState<App | null>(null);
      const [state] = useViewState(connected, INITIAL);
      seen.push(state);
      if (!connected) setConnected(app);
      return null;
    }

    renderToString(<Probe />);

    expect(seen[0]).toBe(INITIAL);
    expect(seen.at(-1)).toEqual(saved);
  });
});
