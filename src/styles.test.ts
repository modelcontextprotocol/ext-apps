import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { applyHostFonts } from "./styles.js";

/**
 * Minimal `document` stub for bun's DOM-less test environment, covering only
 * what `applyHostFonts` touches: `getElementById`, `createElement("style")`
 * and `head.appendChild`.
 */
function createFakeDocument() {
  const byId = new Map<string, { id: string; textContent: string }>();
  const head: Array<{ id: string; textContent: string }> = [];
  return {
    head: {
      appendChild(element: { id: string; textContent: string }) {
        head.push(element);
        if (element.id) byId.set(element.id, element);
        return element;
      },
    },
    createElement(tag: string) {
      if (tag !== "style") throw new Error(`unexpected element: ${tag}`);
      return { id: "", textContent: "" };
    },
    getElementById(id: string) {
      return byId.get(id) ?? null;
    },
    /** Test helper: style elements appended to `head`, in order. */
    styles: head,
  };
}

describe("applyHostFonts", () => {
  let fakeDocument: ReturnType<typeof createFakeDocument>;
  let originalDocument: unknown;

  beforeEach(() => {
    originalDocument = (globalThis as { document?: unknown }).document;
    fakeDocument = createFakeDocument();
    (globalThis as { document?: unknown }).document = fakeDocument;
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it("injects the font CSS in one style element", () => {
    applyHostFonts("@font-face { font-family: A; }");

    expect(fakeDocument.styles).toHaveLength(1);
    expect(fakeDocument.styles[0]!.textContent).toBe(
      "@font-face { font-family: A; }",
    );
  });

  it("replaces the font CSS when the host sends different fonts", () => {
    applyHostFonts("@font-face { font-family: A; }");
    applyHostFonts("@font-face { font-family: B; }");

    expect(fakeDocument.styles).toHaveLength(1);
    expect(fakeDocument.styles[0]!.textContent).toBe(
      "@font-face { font-family: B; }",
    );
  });

  it("does not add a second style element for the same fonts", () => {
    applyHostFonts("@font-face { font-family: A; }");
    applyHostFonts("@font-face { font-family: A; }");

    expect(fakeDocument.styles).toHaveLength(1);
  });
});
