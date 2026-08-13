import { OptionDefaults } from "typedoc";

const BASE_SDK_DOCS = "https://ts.sdk.modelcontextprotocol.io/v2/";

/** @type {Partial<import('typedoc').TypeDocOptions>} */
const config = {
  name: "MCP Apps",
  readme: "README.md",
  headings: {
    readme: false,
  },
  gitRevision: "main",
  projectDocuments: [
    "docs/overview.md",
    "docs/quickstart.md",
    "docs/agent-skills.md",
    "docs/testing-mcp-apps.md",
    "docs/patterns.md",
    "docs/authorization.md",
    "docs/csp-cors.md",
    "docs/migrate_from_openai_apps.md",
  ],
  entryPoints: [
    "src/server/index.ts",
    "src/app.ts",
    "src/react/index.tsx",
    "src/app-bridge.ts",
    "src/message-transport.ts",
    "src/types.ts",
  ],
  excludePrivate: true,
  excludeInternal: false,
  intentionallyNotExported: ["RequestHandlerExtra"],
  externalSymbolLinkMappings: {
    "@modelcontextprotocol/client": {
      ClientOptions: BASE_SDK_DOCS,
      ConnectOptions: BASE_SDK_DOCS,
      DiscoverResult: BASE_SDK_DOCS,
      "MessageExtraInfo.classification": BASE_SDK_DOCS,
      ProtocolError: BASE_SDK_DOCS,
      "Protocol.close": BASE_SDK_DOCS,
      "Protocol.notification": BASE_SDK_DOCS,
      ResponseCacheStore: BASE_SDK_DOCS,
      SdkError: BASE_SDK_DOCS,
      "SdkErrorCode.MethodNotSupportedByProtocolVersion": BASE_SDK_DOCS,
      "SdkErrorCode.UnsupportedResultType": BASE_SDK_DOCS,
      "__type.enforceStrictCapabilities": BASE_SDK_DOCS,
    },
    "@modelcontextprotocol/server": {
      LoggingMessageNotification: BASE_SDK_DOCS,
      "McpServer.registerTool": BASE_SDK_DOCS,
      "MessageExtraInfo.classification": BASE_SDK_DOCS,
      "Protocol.close": BASE_SDK_DOCS,
      "Protocol.notification": BASE_SDK_DOCS,
      "SdkErrorCode.UnsupportedResultType": BASE_SDK_DOCS,
    },
  },
  blockTags: [...OptionDefaults.blockTags, "@description"],
  jsDocCompatibility: {
    exampleTag: false,
  },
  includeVersion: false,
  categorizeByGroup: true,
  groupOrder: ["Getting Started", "Security", "Modules", "*"],
  navigation: {
    includeGroups: true,
  },
  navigationLinks: {
    GitHub: "https://github.com/modelcontextprotocol/ext-apps",
    Specification:
      "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx",
  },
  hostedBaseUrl: "https://apps.extensions.modelcontextprotocol.io/api/",
  customCss: "./docs/mcp-theme.css",
  out: "docs/api",
  plugin: [
    "typedoc-github-theme",
    "./scripts/typedoc-plugin-base-sdk-links.mjs",
    "./scripts/typedoc-plugin-fix-mermaid-entities.mjs",
    "./scripts/typedoc-plugin-seo.mjs",
    "./scripts/typedoc-plugin-mcpstyle.mjs",
    "@boneskull/typedoc-plugin-mermaid",
  ],
  ignoredHighlightLanguages: ["mermaid"],
  locales: {
    en: {
      kind_plural_document: "Getting Started",
      kind_plural_module: "API Documentation",
    },
  },
};

export default config;
