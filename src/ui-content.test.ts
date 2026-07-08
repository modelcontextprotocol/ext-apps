import { describe, it, expect } from "bun:test";
import {
  createViewContentBlock,
  getViewContentBlocks,
  isViewContentBlock,
  supportsContentMimeType,
} from "./ui-content";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const A2UI_MIME_TYPE = "application/a2ui+json";

describe("createViewContentBlock", () => {
  it("should create a marked embedded resource block from text", () => {
    const block = createViewContentBlock({
      uri: "a2ui://server/surfaces/1",
      mimeType: A2UI_MIME_TYPE,
      text: '{"beginRendering":{}}',
    });
    expect(block).toEqual({
      type: "resource",
      resource: {
        uri: "a2ui://server/surfaces/1",
        mimeType: A2UI_MIME_TYPE,
        text: '{"beginRendering":{}}',
      },
      _meta: { ui: { content: {} } },
    });
  });

  it("should create a block from blob", () => {
    const block = createViewContentBlock({
      uri: "data://server/1",
      mimeType: "application/octet-stream",
      blob: "AAAA",
    });
    expect(block.resource).toEqual({
      uri: "data://server/1",
      mimeType: "application/octet-stream",
      blob: "AAAA",
    });
  });

  it("should include rendererUri in the marker when provided", () => {
    const block = createViewContentBlock({
      uri: "a2ui://server/surfaces/1",
      mimeType: A2UI_MIME_TYPE,
      text: "{}",
      rendererUri: "ui://server/renderer",
    });
    expect(block._meta.ui.content).toEqual({
      rendererUri: "ui://server/renderer",
    });
  });

  it("should reject providing neither or both of text and blob", () => {
    expect(() =>
      createViewContentBlock({ uri: "a2ui://x", mimeType: A2UI_MIME_TYPE }),
    ).toThrow("exactly one of `text` or `blob`");
    expect(() =>
      createViewContentBlock({
        uri: "a2ui://x",
        mimeType: A2UI_MIME_TYPE,
        text: "{}",
        blob: "AAAA",
      }),
    ).toThrow("exactly one of `text` or `blob`");
  });

  it("should reject ui:// payload URIs", () => {
    expect(() =>
      createViewContentBlock({
        uri: "ui://server/renderer",
        mimeType: A2UI_MIME_TYPE,
        text: "{}",
      }),
    ).toThrow("ui://");
  });
});

describe("isViewContentBlock", () => {
  it("should accept marked embedded resources", () => {
    const block = createViewContentBlock({
      uri: "a2ui://x",
      mimeType: A2UI_MIME_TYPE,
      text: "{}",
    });
    expect(isViewContentBlock(block)).toBe(true);
  });

  it("should reject unmarked and non-resource blocks", () => {
    expect(isViewContentBlock({ type: "text", text: "hi" })).toBe(false);
    expect(
      isViewContentBlock({
        type: "resource",
        resource: { uri: "file://x", mimeType: "text/plain", text: "hi" },
      }),
    ).toBe(false);
    expect(
      isViewContentBlock({
        type: "resource",
        resource: { uri: "file://x", mimeType: "text/plain", text: "hi" },
        _meta: { ui: {} },
      }),
    ).toBe(false);
  });
});

describe("getViewContentBlocks", () => {
  const result: Pick<CallToolResult, "content"> = {
    content: [
      { type: "text", text: "Found 3 flights" },
      createViewContentBlock({
        uri: "a2ui://server/surfaces/1",
        mimeType: A2UI_MIME_TYPE,
        text: "{}",
      }),
      {
        type: "resource",
        resource: { uri: "file://report", mimeType: "text/csv", text: "a,b" },
      },
      createViewContentBlock({
        uri: "custom://server/2",
        mimeType: "application/vnd.custom+json",
        text: "{}",
        rendererUri: "ui://server/other-renderer",
      }),
    ],
  };

  it("should return only marked blocks, in order", () => {
    const blocks = getViewContentBlocks(result);
    expect(blocks.map((b) => b.resource.uri)).toEqual([
      "a2ui://server/surfaces/1",
      "custom://server/2",
    ]);
  });

  it("should filter by mimeType", () => {
    const blocks = getViewContentBlocks(result, { mimeType: A2UI_MIME_TYPE });
    expect(blocks.map((b) => b.resource.uri)).toEqual([
      "a2ui://server/surfaces/1",
    ]);
  });

  it("should filter by rendererUri, including untargeted blocks", () => {
    expect(
      getViewContentBlocks(result, {
        rendererUri: "ui://server/other-renderer",
      }).map((b) => b.resource.uri),
    ).toEqual(["a2ui://server/surfaces/1", "custom://server/2"]);
    expect(
      getViewContentBlocks(result, {
        rendererUri: "ui://server/renderer",
      }).map((b) => b.resource.uri),
    ).toEqual(["a2ui://server/surfaces/1"]);
  });

  it("should handle results with no content", () => {
    expect(getViewContentBlocks({ content: [] })).toEqual([]);
  });
});

describe("supportsContentMimeType", () => {
  it("should match declared MIME types", () => {
    expect(supportsContentMimeType([A2UI_MIME_TYPE], A2UI_MIME_TYPE)).toBe(
      true,
    );
    expect(supportsContentMimeType(["text/plain"], A2UI_MIME_TYPE)).toBe(false);
  });

  it("should honor the wildcard", () => {
    expect(supportsContentMimeType(["*"], A2UI_MIME_TYPE)).toBe(true);
  });

  it("should return false when unset", () => {
    expect(supportsContentMimeType(undefined, A2UI_MIME_TYPE)).toBe(false);
    expect(supportsContentMimeType([], A2UI_MIME_TYPE)).toBe(false);
  });
});
