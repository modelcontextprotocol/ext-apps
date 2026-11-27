import { describe, expect, test } from "bun:test";
import { resolveToolName } from "./tool-names";

describe("resolveToolName", () => {
  test("applies the host's prefix to other tools", () => {
    expect(resolveToolName("save_pdf", "pdf-server-display_pdf")).toBe(
      "pdf-server-save_pdf",
    );
    expect(resolveToolName("poll_pdf_commands", "a__b__display_pdf")).toBe(
      "a__b__poll_pdf_commands",
    );
  });

  test("keeps the bare name when the host does not rewrite names", () => {
    expect(resolveToolName("save_pdf", "display_pdf")).toBe("save_pdf");
  });

  test("keeps the bare name when there is no host context", () => {
    expect(resolveToolName("save_pdf", undefined)).toBe("save_pdf");
    expect(resolveToolName("save_pdf", null)).toBe("save_pdf");
    expect(resolveToolName("save_pdf", "")).toBe("save_pdf");
  });

  test("keeps the bare name when the invoked tool is not the entry tool", () => {
    expect(resolveToolName("save_pdf", "other-server-get-time")).toBe(
      "save_pdf",
    );
  });
});
