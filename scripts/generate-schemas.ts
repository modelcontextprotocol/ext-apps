/**
 * Schema Generation Script using ts-to-zod as a library
 *
 * This script generates Zod schemas from spec.types.ts and performs necessary
 * post-processing for compatibility with this project.
 *
 * ## Why Post-Processing is Needed
 *
 * ts-to-zod is a powerful tool but has limitations that require post-processing:
 *
 * ### 1. Zod Import Path (`"zod"` → `"zod/v4"`)
 *
 * **Problem**: ts-to-zod generates `import { z } from "zod"` but this project
 * uses the Zod v4 subpath import `"zod/v4"` for explicit version targeting.
 *
 * **Why it matters**: The `"zod"` import resolves based on package.json exports,
 * which may differ between environments. `"zod/v4"` is explicit and ensures
 * consistent Zod v4 behavior regardless of how the package is configured.
 *
 * **Solution**: Replace the import path in the generated output.
 *
 * ### 2. External Type References (`z.any()` → actual schemas)
 *
 * **Problem**: ts-to-zod cannot resolve types imported from external packages.
 * When it encounters types like `ContentBlock`, `CallToolResult`, `Implementation`,
 * `RequestId`, and `Tool` from `@modelcontextprotocol/sdk`, it generates `z.any()`
 * as a placeholder.
 *
 * **Why it matters**: `z.any()` provides no validation - it accepts anything.
 * The MCP SDK already exports Zod schemas for these types, so we should use them.
 *
 * **Solution**: Replace the `z.any()` placeholders with imports from MCP SDK:
 *   - `contentBlockSchema` → `ContentBlockSchema`
 *   - `callToolResultSchema` → `CallToolResultSchema`
 *   - `implementationSchema` → `ImplementationSchema`
 *   - `requestIdSchema` → `RequestIdSchema`
 *   - `toolSchema` → `ToolSchema`
 *
 * ### 3. Index Signatures (`z.record().and()` → `z.looseObject()`)
 *
 * **Problem**: TypeScript index signatures like `[key: string]: unknown` are
 * translated by ts-to-zod to `z.record(z.string(), z.unknown()).and(z.object({...}))`.
 * This creates a `ZodIntersection` type which:
 *   - Doesn't support `.extend()`, `.pick()`, `.omit()` methods
 *   - Has different runtime behavior than a simple object schema
 *   - Is more complex than needed for our use case
 *
 * **Why it matters**: Our interfaces use index signatures for MCP SDK Protocol
 * compatibility (allowing extra fields), but we don't need intersection semantics.
 * Zod v4's `z.looseObject()` is designed exactly for this: an object that allows
 * extra keys (like `z.object().passthrough()` but more ergonomic).
 *
 * **Solution**: Replace the intersection pattern with `z.looseObject()`.
 *
 * ## Using ts-to-zod as a Library
 *
 * Benefits of using the library API vs CLI:
 * - `generateIntegrationTests()`: Auto-generate tests verifying schemas match types
 * - `generateZodInferredType()`: Generate `type X = z.infer<typeof xSchema>` exports
 * - Programmatic error handling and reporting
 * - More control over the generation pipeline
 *
 * @see https://github.com/fabien0102/ts-to-zod
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "ts-to-zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const SPEC_TYPES_FILE = join(PROJECT_ROOT, "src", "spec.types.ts");
const SCHEMAS_OUTPUT_FILE = join(PROJECT_ROOT, "src", "schemas.generated.ts");
const TESTS_OUTPUT_FILE = join(
  PROJECT_ROOT,
  "src",
  "schemas.generated.test.ts",
);

/**
 * External types from MCP SDK that ts-to-zod can't resolve.
 * Maps the camelCase schema name ts-to-zod generates to the PascalCase export from MCP SDK.
 */
const EXTERNAL_TYPE_MAPPINGS: Record<string, string> = {
  contentBlockSchema: "ContentBlockSchema",
  callToolResultSchema: "CallToolResultSchema",
  implementationSchema: "ImplementationSchema",
  requestIdSchema: "RequestIdSchema",
  toolSchema: "ToolSchema",
};

function main() {
  console.log("🔧 Generating Zod schemas from spec.types.ts...\n");

  // Read source file
  const sourceText = readFileSync(SPEC_TYPES_FILE, "utf-8");

  // Generate using ts-to-zod library API
  const result = generate({
    sourceText,
    keepComments: true,
    skipParseJSDoc: false,
  });

  // Report any errors
  if (result.errors.length > 0) {
    console.error("❌ Generation errors:");
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  if (result.hasCircularDependencies) {
    console.warn("⚠️  Warning: Circular dependencies detected in types");
  }

  // Get the generated schema file content
  let schemasContent = result.getZodSchemasFile("./spec.types.js");

  // Post-process the generated content
  schemasContent = postProcess(schemasContent);

  // Write schemas file
  writeFileSync(SCHEMAS_OUTPUT_FILE, schemasContent, "utf-8");
  console.log(`✅ Written: ${SCHEMAS_OUTPUT_FILE}`);

  // Generate integration tests
  const testsContent = result.getIntegrationTestFile(
    "./spec.types.js",
    "./schemas.generated.js",
  );
  if (testsContent) {
    const processedTests = postProcessTests(testsContent);
    writeFileSync(TESTS_OUTPUT_FILE, processedTests, "utf-8");
    console.log(`✅ Written: ${TESTS_OUTPUT_FILE}`);
  }

  console.log("\n🎉 Schema generation complete!");
}

/**
 * Post-process generated schemas for project compatibility.
 */
function postProcess(content: string): string {
  // 1. Update import to use zod/v4
  // WHY: This project uses explicit zod/v4 subpath for version clarity
  content = content.replace(
    'import { z } from "zod";',
    'import { z } from "zod/v4";',
  );

  // 2. Add MCP SDK schema imports
  // WHY: ts-to-zod generates z.any() for external types; we need real schemas
  const mcpImports = Object.values(EXTERNAL_TYPE_MAPPINGS).join(",\n  ");
  content = content.replace(
    'import { z } from "zod/v4";',
    `import { z } from "zod/v4";
import {
  ${mcpImports},
} from "@modelcontextprotocol/sdk/types.js";`,
  );

  // 3. Replace z.any() placeholders with MCP SDK schemas
  // WHY: z.any() provides no validation; MCP SDK exports proper schemas
  for (const [placeholder, schema] of Object.entries(EXTERNAL_TYPE_MAPPINGS)) {
    content = content.replace(
      new RegExp(`const ${placeholder} = z\\.any\\(\\);`, "g"),
      `const ${placeholder} = ${schema};`,
    );
  }

  // 4. Replace z.record().and(z.object()) with z.looseObject()
  // WHY: Index signatures create ZodIntersection which lacks .extend() etc.
  //      z.looseObject() is the Zod v4 idiom for objects allowing extra keys
  content = content.replace(
    /z\.record\(z\.string\(\), z\.unknown\(\)\)\.and\(z\.object\(\{([^}]*)\}\)\)/gs,
    (_, objectContent) => {
      return `z.looseObject({${objectContent}})`;
    },
  );

  // 5. Add header comment
  content = content.replace(
    "// Generated by ts-to-zod",
    `// Generated by ts-to-zod
// Post-processed for Zod v4 and MCP SDK compatibility
// Run: npm run generate:schemas`,
  );

  return content;
}

/**
 * Post-process generated integration tests.
 */
function postProcessTests(content: string): string {
  // Update zod import for tests too
  content = content.replace(
    'import { z } from "zod";',
    'import { z } from "zod/v4";',
  );

  // Add header
  content = content.replace(
    "// Generated by ts-to-zod",
    `// Generated by ts-to-zod
// Integration tests verifying schemas match TypeScript types
// Run: npm run generate:schemas`,
  );

  return content;
}

main();
