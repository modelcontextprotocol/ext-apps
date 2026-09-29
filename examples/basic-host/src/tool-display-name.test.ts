/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Tool } from "@modelcontextprotocol/client";
import { getToolDisplayName } from "./tool-display-name";

const tool = (overrides: Partial<Tool> = {}): Tool => ({
  name: "list_design_systems",
  inputSchema: { type: "object" },
  ...overrides,
});

describe("getToolDisplayName", () => {
  test("prefers title over annotations.title and name", () => {
    expect(getToolDisplayName(tool({
      title: "Listing design systems",
      annotations: { title: "Annotated title" },
    }))).toBe("Listing design systems");
  });

  test("falls back to annotations.title", () => {
    expect(getToolDisplayName(tool({
      annotations: { title: "Annotated title" },
    }))).toBe("Annotated title");
  });

  test("falls back to name", () => {
    expect(getToolDisplayName(tool())).toBe("list_design_systems");
  });
});
