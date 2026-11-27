import { describe, expect, it } from "bun:test";

import { applyHostStyleVariables } from "./styles.js";
import type { McpUiStyles } from "./types.js";

function fakeRoot() {
  const props = new Map<string, string>();
  return {
    style: {
      setProperty: (key: string, value: string) => props.set(key, value),
      removeProperty: (key: string) => props.delete(key),
      getPropertyValue: (key: string) => props.get(key) ?? "",
    },
  } as unknown as HTMLElement;
}

describe("applyHostStyleVariables", () => {
  it("clears variables that the host drops from its context", () => {
    const root = fakeRoot();
    applyHostStyleVariables(
      { "--color-background-primary": "red" } as McpUiStyles,
      root,
    );
    expect(root.style.getPropertyValue("--color-background-primary")).toBe(
      "red",
    );

    applyHostStyleVariables(
      { "--color-background-primary": undefined } as McpUiStyles,
      root,
    );
    expect(root.style.getPropertyValue("--color-background-primary")).toBe("");
  });
});
