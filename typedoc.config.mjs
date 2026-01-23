import { OptionDefaults } from "typedoc";

/** @type {Partial<import('typedoc').TypeDocOptions>} */
const config = {
  readme: "README.md",
  headings: {
    readme: false,
  },
  gitRevision: "main",
  projectDocuments: [
    "docs/quickstart.md",
    "docs/patterns.md",
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
  intentionallyNotExported: ["AppOptions"],
  blockTags: [...OptionDefaults.blockTags, "@description"],
  jsDocCompatibility: {
    exampleTag: false,
  },
  includeVersion: true,
  categorizeByGroup: true,
  navigation: {
    includeGroups: true,
  },
  navigationLinks: {
    GitHub: "https://github.com/modelcontextprotocol/ext-apps",
    Specification:
      "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx",
  },
  out: "docs/api",
  plugin: ["typedoc-github-theme"],
};

export default config;
