/**
 * Type-checked examples for {@link ui-content!} helpers.
 *
 * These examples are included in the API documentation via code fences with
 * `source` attributes. Each function's region markers define the code snippet
 * that appears in the docs.
 *
 * @module
 */

import type { App } from "./app";
import {
  createViewContentBlock,
  getViewContentBlocks,
  supportsContentMimeType,
} from "./ui-content";
import type { McpUiClientCapabilities } from "./spec.types";

declare const app: App;
declare const uiCap: McpUiClientCapabilities | undefined;
declare function searchFlights(route: string): Promise<{ summary: string }>;
declare function buildA2uiSurface(route: string): string;
declare function renderA2ui(payloads: string[]): void;

const A2UI_MIME_TYPE = "application/a2ui+json";

async function createViewContentBlockExamples(route: string) {
  //#region createViewContentBlock_toolResult
  // Server: return a typed payload alongside the text fallback
  const flights = await searchFlights(route);
  return {
    content: [
      { type: "text" as const, text: flights.summary },
      createViewContentBlock({
        uri: `a2ui://flight-server/surfaces/${encodeURIComponent(route)}`,
        mimeType: A2UI_MIME_TYPE,
        text: buildA2uiSurface(route),
      }),
    ],
  };
  //#endregion createViewContentBlock_toolResult
}

function getViewContentBlocksExamples() {
  //#region getViewContentBlocks_ontoolresult
  // View: extract payloads from delivered tool results
  app.ontoolresult = (result) => {
    const payloads = getViewContentBlocks(result, {
      mimeType: A2UI_MIME_TYPE,
    });
    renderA2ui(
      payloads.map((block) =>
        "text" in block.resource
          ? block.resource.text
          : atob(block.resource.blob),
      ),
    );
  };
  //#endregion getViewContentBlocks_ontoolresult
}

function supportsContentMimeTypeExamples() {
  //#region supportsContentMimeType_checkSupport
  // Server: register the renderer-pattern tool only when the host
  // forwards this payload type (handles the ["*"] wildcard)
  if (supportsContentMimeType(uiCap?.contentMimeTypes, A2UI_MIME_TYPE)) {
    // register tool returning marked A2UI payloads
  } else {
    // register text-only or structuredContent-driven variant
  }
  //#endregion supportsContentMimeType_checkSupport
}

export {
  createViewContentBlockExamples,
  getViewContentBlocksExamples,
  supportsContentMimeTypeExamples,
};
