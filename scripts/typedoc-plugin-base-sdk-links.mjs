/**
 * Resolve module-local links inherited from the base MCP SDK declarations.
 *
 * TypeDoc's externalSymbolLinkMappings handles package-qualified symbols, but
 * the base SDK writes this particular reference as `index.inputRequired`.
 */

const BASE_SDK_DOCS = "https://ts.sdk.modelcontextprotocol.io/v2/";

/** @param {import("typedoc").Application} app */
export function load(app) {
  app.converter.addUnknownSymbolResolver((ref) => {
    const name = ref.symbolReference?.path?.map((part) => part.path).join(".");
    if (name === "index.inputRequired") return BASE_SDK_DOCS;
  });
}
