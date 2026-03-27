import { describe, it, expect } from "bun:test";
import {
  validateContentModalities,
  buildValidationErrorMessage,
} from "./content-validation";

describe("validateContentModalities", () => {
  it("returns valid when modalities is undefined (backwards compat)", () => {
    const result = validateContentModalities(
      [{ type: "text", text: "hello" }],
      undefined,
    );
    expect(result.valid).toBe(true);
    expect(result.unsupportedTypes).toEqual([]);
    expect(result.structuredContentUnsupported).toBe(false);
  });

  it("returns valid when all content types are supported", () => {
    const result = validateContentModalities(
      [
        { type: "text", text: "hello" },
        { type: "image", data: "base64data", mimeType: "image/png" },
      ],
      { text: {}, image: {} },
    );
    expect(result.valid).toBe(true);
    expect(result.unsupportedTypes).toEqual([]);
  });

  it("returns invalid with unsupported types listed", () => {
    const result = validateContentModalities(
      [
        { type: "text", text: "hello" },
        { type: "image", data: "base64data", mimeType: "image/png" },
      ],
      { text: {} },
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedTypes).toEqual(["image"]);
  });

  it("handles resource_link → resourceLink mapping", () => {
    const result = validateContentModalities(
      [{ type: "resource_link", uri: "test://resource", name: "test" }],
      { resourceLink: {} },
    );
    expect(result.valid).toBe(true);
    expect(result.unsupportedTypes).toEqual([]);
  });

  it("returns invalid when resource_link is used without resourceLink modality", () => {
    const result = validateContentModalities(
      [{ type: "resource_link", uri: "test://resource", name: "test" }],
      { text: {} },
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedTypes).toEqual(["resource_link"]);
  });

  it("detects unsupported structuredContent", () => {
    const result = validateContentModalities([], { text: {} }, true);
    expect(result.valid).toBe(false);
    expect(result.structuredContentUnsupported).toBe(true);
  });

  it("allows structuredContent when declared", () => {
    const result = validateContentModalities(
      [],
      { text: {}, structuredContent: {} },
      true,
    );
    expect(result.valid).toBe(true);
    expect(result.structuredContentUnsupported).toBe(false);
  });

  it("handles undefined content array", () => {
    const result = validateContentModalities(undefined, { text: {} });
    expect(result.valid).toBe(true);
    expect(result.unsupportedTypes).toEqual([]);
  });

  it("handles empty content array", () => {
    const result = validateContentModalities([], { text: {} });
    expect(result.valid).toBe(true);
    expect(result.unsupportedTypes).toEqual([]);
  });

  it("deduplicates unsupported type names", () => {
    const result = validateContentModalities(
      [
        { type: "image", data: "a", mimeType: "image/png" },
        { type: "image", data: "b", mimeType: "image/png" },
        { type: "audio", data: "c", mimeType: "audio/mp3" },
      ],
      { text: {} },
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedTypes).toEqual(["image", "audio"]);
  });

  it("rejects all content types when modalities is empty object", () => {
    const result = validateContentModalities(
      [{ type: "text", text: "hello" }],
      {},
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedTypes).toEqual(["text"]);
  });

  it("handles audio content type", () => {
    const result = validateContentModalities(
      [{ type: "audio", data: "base64", mimeType: "audio/mp3" }],
      { audio: {} },
    );
    expect(result.valid).toBe(true);
  });

  it("handles resource content type", () => {
    const result = validateContentModalities(
      [{ type: "resource", resource: { uri: "test://r", text: "content" } }],
      { resource: {} },
    );
    expect(result.valid).toBe(true);
  });

  it("returns invalid for unknown content type", () => {
    const result = validateContentModalities(
      [{ type: "unknown_type" } as any],
      { text: {} },
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedTypes).toEqual(["unknown_type"]);
  });

  it("validates both content blocks and structuredContent together", () => {
    const result = validateContentModalities(
      [{ type: "image", data: "data", mimeType: "image/png" }],
      { text: {} },
      true,
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedTypes).toEqual(["image"]);
    expect(result.structuredContentUnsupported).toBe(true);
  });
});

describe("buildValidationErrorMessage", () => {
  it("builds message for unsupported content types", () => {
    const msg = buildValidationErrorMessage(
      {
        valid: false,
        unsupportedTypes: ["image", "audio"],
        structuredContentUnsupported: false,
      },
      "ui/message",
    );
    expect(msg).toBe("ui/message: unsupported content type(s): image, audio");
  });

  it("builds message for unsupported structuredContent", () => {
    const msg = buildValidationErrorMessage(
      {
        valid: false,
        unsupportedTypes: [],
        structuredContentUnsupported: true,
      },
      "ui/update-model-context",
    );
    expect(msg).toBe(
      "ui/update-model-context: structuredContent is not supported",
    );
  });

  it("builds message with both unsupported types and structuredContent", () => {
    const msg = buildValidationErrorMessage(
      {
        valid: false,
        unsupportedTypes: ["image"],
        structuredContentUnsupported: true,
      },
      "ui/update-model-context",
    );
    expect(msg).toBe(
      "ui/update-model-context: unsupported content type(s): image; structuredContent is not supported",
    );
  });
});
