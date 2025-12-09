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
 * **Solution**: Replace the import path in the generated output.
 *
 * ### 2. External Type References (`z.any()` → actual schemas)
 *
 * **Problem**: ts-to-zod cannot resolve types imported from external packages.
 * When it encounters types like `ContentBlock`, `CallToolResult`, `Implementation`,
 * `RequestId`, and `Tool` from `@modelcontextprotocol/sdk`, it generates `z.any()`
 * as a placeholder.
 *
 * **Solution**: Import the schemas from MCP SDK and remove the z.any() placeholders.
 *
 * ### 3. Index Signatures (`z.record().and()` → `z.looseObject()`)
 *
 * **Problem**: TypeScript index signatures like `[key: string]: unknown` are
 * translated by ts-to-zod to `z.record(z.string(), z.unknown()).and(z.object({...}))`.
 * This creates a `ZodIntersection` type which doesn't support `.extend()` etc.
 *
 * **Solution**: Replace the intersection pattern with `z.looseObject()`.
 *
 * ## Adding Schema Descriptions
 *
 * ts-to-zod supports `@description` JSDoc tags to generate `.describe()` calls:
 *
 * ```typescript
 * interface MyType {
 *   /​** @description The user's full name *​/
 *   name: string;
 * }
 * ```
 *
 * Generates: `name: z.string().describe("The user's full name")`
 *
 * @see https://github.com/fabien0102/ts-to-zod
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "ts-to-zod";
import { toJSONSchema, type $ZodType } from "zod/v4/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const SPEC_TYPES_FILE = join(PROJECT_ROOT, "src", "spec.types.ts");
const GENERATED_DIR = join(PROJECT_ROOT, "src", "generated");
const SCHEMA_OUTPUT_FILE = join(GENERATED_DIR, "schema.ts");
const SCHEMA_TEST_OUTPUT_FILE = join(GENERATED_DIR, "schema.test.ts");
const JSON_SCHEMA_OUTPUT_FILE = join(GENERATED_DIR, "schema.json");

/**
 * External types from MCP SDK that ts-to-zod can't resolve.
 * With PascalCase naming (via getSchemaName), generated placeholders match MCP SDK exports.
 */
const EXTERNAL_TYPE_SCHEMAS = [
  "ContentBlockSchema",
  "CallToolResultSchema",
  "ImplementationSchema",
  "RequestIdSchema",
  "ToolSchema",
];

async function main() {
  console.log("🔧 Generating Zod schemas from spec.types.ts...\n");

  const sourceText = readFileSync(SPEC_TYPES_FILE, "utf-8");

  const result = generate({
    sourceText,
    keepComments: true,
    skipParseJSDoc: false,
    // Generate PascalCase schema names: McpUiOpenLinkRequest → McpUiOpenLinkRequestSchema
    getSchemaName: (typeName: string) => `${typeName}Schema`,
  });

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

  let schemasContent = result.getZodSchemasFile("../spec.types.js");
  schemasContent = postProcess(schemasContent);

  writeFileSync(SCHEMA_OUTPUT_FILE, schemasContent, "utf-8");
  console.log(`✅ Written: ${SCHEMA_OUTPUT_FILE}`);

  const testsContent = result.getIntegrationTestFile(
    "../spec.types.js",
    "./schema.js",
  );
  if (testsContent) {
    const processedTests = postProcessTests(testsContent);
    writeFileSync(SCHEMA_TEST_OUTPUT_FILE, processedTests, "utf-8");
    console.log(`✅ Written: ${SCHEMA_TEST_OUTPUT_FILE}`);
  }

  // Generate JSON Schema from the Zod schemas
  await generateJsonSchema();

  console.log("\n🎉 Schema generation complete!");
}

/**
 * Generate JSON Schema from the Zod schemas.
 * Uses dynamic import to load the generated schemas after they're written.
 */
async function generateJsonSchema() {
  // Dynamic import of the generated schemas
  // tsx handles TypeScript imports at runtime
  const schemas = await import("../src/generated/schema.js");

  const jsonSchema: {
    $schema: string;
    $id: string;
    title: string;
    description: string;
    $defs: Record<string, unknown>;
  } = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://modelcontextprotocol.io/ext-apps/schema.json",
    title: "MCP Apps Protocol",
    description: "JSON Schema for MCP Apps UI protocol messages",
    $defs: {},
  };

  // Convert each exported Zod schema to JSON Schema
  for (const [name, schema] of Object.entries(schemas)) {
    if (
      name.endsWith("Schema") &&
      typeof schema === "object" &&
      schema !== null
    ) {
      const typeName = name.replace(/Schema$/, "");
      try {
        // Use unrepresentable: "any" to handle external types (MCP SDK schemas)
        // that can't be directly represented in JSON Schema
        jsonSchema.$defs[typeName] = toJSONSchema(schema as $ZodType, {
          unrepresentable: "any",
        });
      } catch (error) {
        console.warn(`⚠️  Could not convert ${name} to JSON Schema: ${error}`);
      }
    }
  }

  writeFileSync(
    JSON_SCHEMA_OUTPUT_FILE,
    JSON.stringify(jsonSchema, null, 2) + "\n",
    "utf-8",
  );
  console.log(`✅ Written: ${JSON_SCHEMA_OUTPUT_FILE}`);
}

/**
 * Post-process generated schemas for project compatibility.
 */
function postProcess(content: string): string {
  // 1. Update import to use zod/v4
  content = content.replace(
    'import { z } from "zod";',
    'import { z } from "zod/v4";',
  );

  // 2. Add MCP SDK schema imports
  const mcpImports = EXTERNAL_TYPE_SCHEMAS.join(",\n  ");
  content = content.replace(
    'import { z } from "zod/v4";',
    `import { z } from "zod/v4";
import {
  ${mcpImports},
} from "@modelcontextprotocol/sdk/types.js";`,
  );

  // 3. Remove z.any() placeholders for external types (now imported from MCP SDK)
  for (const schema of EXTERNAL_TYPE_SCHEMAS) {
    content = content.replace(
      new RegExp(`(?:export )?const ${schema} = z\\.any\\(\\);\\n?`, "g"),
      "",
    );
  }

  // 4. Replace z.record().and(z.object({...})) with z.looseObject({...})
  // Uses brace-counting to handle nested objects correctly.
  content = replaceRecordAndWithLooseObject(content);

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
 * Replace z.record(z.string(), z.unknown()).and(z.object({...})) with z.looseObject({...})
 * Uses brace-counting to handle nested objects correctly.
 */
function replaceRecordAndWithLooseObject(content: string): string {
  const pattern = "z.record(z.string(), z.unknown()).and(z.object({";
  let result = content;
  let startIndex = 0;

  while (true) {
    const matchStart = result.indexOf(pattern, startIndex);
    if (matchStart === -1) break;

    // Find the matching closing brace for z.object({
    const objectStart = matchStart + pattern.length;
    let braceCount = 1;
    let i = objectStart;

    while (i < result.length && braceCount > 0) {
      if (result[i] === "{") braceCount++;
      else if (result[i] === "}") braceCount--;
      i++;
    }

    // i now points after the closing } of z.object({...})
    // Check if followed by ))
    if (result.slice(i, i + 2) === "))") {
      const objectContent = result.slice(objectStart, i - 1);
      const replacement = `z.looseObject({${objectContent}})`;
      result = result.slice(0, matchStart) + replacement + result.slice(i + 2);
      startIndex = matchStart + replacement.length;
    } else {
      startIndex = i;
    }
  }

  return result;
}

/**
 * Post-process generated integration tests.
 */
function postProcessTests(content: string): string {
  content = content.replace(
    'import { z } from "zod";',
    'import { z } from "zod/v4";',
  );

  content = content.replace(
    "// Generated by ts-to-zod",
    `// Generated by ts-to-zod
// Integration tests verifying schemas match TypeScript types
// Run: npm run generate:schemas`,
  );

  return content;
}

main().catch((error) => {
  console.error("❌ Schema generation failed:", error);
  process.exit(1);
});
