/**
 * PDF Annotation — Claude API prompt discovery tests
 *
 * Tests that Claude can discover and use PDF annotation capabilities
 * when given the display_pdf result and interact tool descriptions.
 *
 * These tests call the Anthropic API directly and are DISABLED by default.
 * To enable:
 *   ANTHROPIC_API_KEY=sk-ant-... npx playwright test tests/e2e/pdf-annotations-api.spec.ts
 */

import { test, expect } from "@playwright/test";

const API_KEY = process.env.ANTHROPIC_API_KEY;

// Skip all tests if no API key
test.skip(!API_KEY, "Set ANTHROPIC_API_KEY to run API prompt tests");
test.setTimeout(60000);

// Tool definitions matching the PDF server's registered tools
const TOOLS = [
  {
    name: "display_pdf",
    description:
      "Display a PDF in an interactive viewer. Returns a viewUUID for subsequent interact calls.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "URL or path to the PDF file",
          default: "https://arxiv.org/pdf/1706.03762",
        },
        page: {
          type: "number",
          description: "Initial page to display (1-indexed)",
          minimum: 1,
        },
      },
    },
  },
  {
    name: "interact",
    description: `Interact with a PDF viewer: annotate, navigate, search, extract pages, fill forms.

**ANNOTATION** — You can add visual annotations to any page. Use add_annotations with an array of annotation objects.
Each annotation needs: id (unique string), type, page (1-indexed).
Coordinates use PDF points (72 dpi), bottom-left origin.

Annotation types:
• highlight: rects:[{x,y,width,height}], color?, content? — semi-transparent overlay on text regions
• underline: rects:[{x,y,width,height}], color? — underline below text
• strikethrough: rects:[{x,y,width,height}], color? — line through text
• note: x, y, content, color? — sticky note icon with tooltip
• rectangle: x, y, width, height, color?, fillColor? — outlined/filled box
• freetext: x, y, content, fontSize?, color? — arbitrary text label
• stamp: x, y, label (APPROVED|DRAFT|CONFIDENTIAL|FINAL|VOID|REJECTED), color?, rotation? — stamp overlay

Example — add a highlight and a stamp on page 1:
\`\`\`json
{"action":"add_annotations","viewUUID":"…","annotations":[
  {"id":"h1","type":"highlight","page":1,"rects":[{"x":72,"y":700,"width":200,"height":12}]},
  {"id":"s1","type":"stamp","page":1,"x":300,"y":500,"label":"APPROVED","color":"green","rotation":-15}
]}
\`\`\`

**HIGHLIGHT TEXT** — highlight_text: auto-find and highlight text by query. Requires \`query\`. Optional: page, color, content.

**ANNOTATION MANAGEMENT**:
• update_annotations: partial update (id+type required). • remove_annotations: remove by ids.

**NAVIGATION & SEARCH**:
• navigate: go to page (requires \`page\`)
• search: highlight matches in UI (requires \`query\`). Results in model context.
• find: silent search, no UI change (requires \`query\`). Results in model context.
• search_navigate: jump to match (requires \`matchIndex\`)
• zoom: set scale 0.5–3.0 (requires \`scale\`)

**PAGE EXTRACTION** — get_pages: extract text/screenshots from page ranges without navigating. \`intervals\` = [{start?,end?}], e.g. [{}] for all. \`getText\` (default true), \`getScreenshots\` (default false). Max 20 pages.

**FORMS** — fill_form: fill fields with \`fields\` array of {name, value}.`,
    input_schema: {
      type: "object" as const,
      required: ["viewUUID", "action"],
      properties: {
        viewUUID: {
          type: "string",
          description:
            "The viewUUID of the PDF viewer (from display_pdf result)",
        },
        action: {
          type: "string",
          enum: [
            "navigate",
            "search",
            "find",
            "search_navigate",
            "zoom",
            "add_annotations",
            "update_annotations",
            "remove_annotations",
            "highlight_text",
            "fill_form",
            "get_pages",
          ],
          description: "Action to perform",
        },
        page: {
          type: "number",
          minimum: 1,
          description: "Page number (for navigate, highlight_text)",
        },
        query: {
          type: "string",
          description: "Search text (for search / find / highlight_text)",
        },
        matchIndex: {
          type: "number",
          minimum: 0,
          description: "Match index (for search_navigate)",
        },
        scale: {
          type: "number",
          minimum: 0.5,
          maximum: 3.0,
          description: "Zoom scale (for zoom)",
        },
        annotations: {
          type: "array",
          description:
            "Annotation objects for add_annotations or update_annotations",
          items: { type: "object" },
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Annotation IDs (for remove_annotations)",
        },
        color: {
          type: "string",
          description: "Color override (for highlight_text)",
        },
        content: {
          type: "string",
          description: "Tooltip/note content (for highlight_text)",
        },
        fields: {
          type: "array",
          items: { type: "object" },
          description: "Form fields (for fill_form)",
        },
        intervals: {
          type: "array",
          items: { type: "object" },
          description: "Page ranges for get_pages",
        },
        getText: {
          type: "boolean",
          description: "Include text (for get_pages, default true)",
        },
        getScreenshots: {
          type: "boolean",
          description: "Include screenshots (for get_pages, default false)",
        },
      },
    },
  },
];

// Simulated display_pdf result the model would see after calling display_pdf
const DISPLAY_PDF_RESULT_TEXT = `Displaying PDF (viewUUID: abc-123-def): https://arxiv.org/pdf/1706.03762.

Use the \`interact\` tool with this viewUUID. Available actions:
- navigate: go to a page
- search / find: search text (search highlights in UI, find is silent)
- search_navigate: jump to a search match by index
- zoom: set zoom level (0.5–3.0)
- add_annotations: add highlights, underlines, strikethroughs, notes, rectangles, freetext, stamps (APPROVED/DRAFT/CONFIDENTIAL/FINAL/VOID/REJECTED)
- update_annotations: partially update existing annotations
- remove_annotations: remove annotations by ID
- highlight_text: find text by query and highlight it automatically
- fill_form: fill PDF form fields
- get_pages: extract text and/or screenshots from page ranges without navigating`;

/**
 * Conversation history simulating: user asked to display a PDF, model called
 * display_pdf, and the tool returned the result above.
 */
const AFTER_DISPLAY_PDF = [
  {
    role: "user" as const,
    content: "Show me the Attention Is All You Need paper",
  },
  {
    role: "assistant" as const,
    content: [
      {
        type: "tool_use" as const,
        id: "toolu_display_1",
        name: "display_pdf",
        input: { url: "https://arxiv.org/pdf/1706.03762" },
      },
    ],
  },
  {
    role: "user" as const,
    content: [
      {
        type: "tool_result" as const,
        tool_use_id: "toolu_display_1",
        content: DISPLAY_PDF_RESULT_TEXT,
      },
    ],
  },
];

/** Call the Anthropic Messages API and return parsed response. */
async function callClaude(
  messages: Array<{ role: string; content: unknown }>,
): Promise<{
  toolUses: Array<{ name: string; input: Record<string, unknown> }>;
  textBlocks: Array<{ text: string }>;
}> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools: TOOLS,
      messages,
    }),
  });

  expect(response.ok, `API error ${response.status}`).toBe(true);
  const result = await response.json();

  return {
    toolUses: result.content.filter(
      (c: { type: string }) => c.type === "tool_use",
    ),
    textBlocks: result.content.filter(
      (c: { type: string }) => c.type === "text",
    ),
  };
}

/** Check if any tool call uses an annotation-related interact action. */
function usesAnnotationAction(
  toolUses: Array<{ name: string; input: Record<string, unknown> }>,
): boolean {
  return toolUses.some(
    (tu) =>
      tu.name === "interact" &&
      ["add_annotations", "highlight_text", "update_annotations"].includes(
        tu.input.action as string,
      ),
  );
}

/** Check if any tool call uses the interact tool. */
function usesInteract(
  toolUses: Array<{ name: string; input: Record<string, unknown> }>,
): boolean {
  return toolUses.some((tu) => tu.name === "interact");
}

/** Check if text mentions annotation capabilities. */
function mentionsAnnotations(textBlocks: Array<{ text: string }>): boolean {
  const text = textBlocks
    .map((t) => t.text)
    .join(" ")
    .toLowerCase();
  return (
    text.includes("annotati") ||
    text.includes("highlight") ||
    text.includes("stamp") ||
    text.includes("add_annotations") ||
    text.includes("mark up")
  );
}

test.describe("PDF Annotation — API prompt discovery", () => {
  test("model uses highlight_text when asked to highlight the title", async () => {
    const { toolUses } = await callClaude([
      ...AFTER_DISPLAY_PDF,
      {
        role: "user",
        content:
          "Please highlight the title and add an APPROVED stamp on the first page.",
      },
    ]);

    expect(toolUses.length).toBeGreaterThan(0);
    expect(usesAnnotationAction(toolUses)).toBe(true);
  });

  test("model discovers annotation capabilities when asked 'can you annotate?'", async () => {
    const { toolUses, textBlocks } = await callClaude([
      ...AFTER_DISPLAY_PDF,
      {
        role: "user",
        content: "Can you annotate this PDF? Mark important sections for me.",
      },
    ]);

    // Model should either use annotations directly or acknowledge it can
    const discovers =
      usesAnnotationAction(toolUses) ||
      usesInteract(toolUses) ||
      mentionsAnnotations(textBlocks);
    expect(discovers).toBe(true);
  });

  test("model uses add_annotations or get_pages when asked to add notes", async () => {
    const { toolUses } = await callClaude([
      ...AFTER_DISPLAY_PDF,
      {
        role: "user",
        content:
          "Add a note on page 1 saying 'Key contribution' at position (200, 500), and highlight the abstract.",
      },
    ]);

    expect(toolUses.length).toBeGreaterThan(0);
    // Model should use interact (either to annotate directly or to read first)
    expect(usesInteract(toolUses)).toBe(true);
  });
});
