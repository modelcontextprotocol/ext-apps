#!/usr/bin/env npx tsx
/**
 * Generate Kotlin types from MCP Apps JSON Schema
 *
 * Usage: npx tsx scripts/generate-kotlin-types.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..");
const SCHEMA_FILE = join(PROJECT_DIR, "src/generated/schema.json");
const OUTPUT_FILE = join(
  PROJECT_DIR,
  "kotlin/src/main/kotlin/io/modelcontextprotocol/apps/generated/SchemaTypes.kt",
);

interface JsonSchema {
  type?: string;
  const?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  required?: string[];
  anyOf?: JsonSchema[];
  $ref?: string;
  items?: JsonSchema;
  enum?: string[];
  default?: unknown;
}

interface SchemaDoc {
  $defs: Record<string, JsonSchema>;
}

// Type name mapping for consistency
const CANONICAL_NAMES: Record<string, string> = {
  McpUiInitializeResultHostCapabilities: "McpUiHostCapabilities",
  McpUiInitializeResultHostCapabilitiesServerTools: "ServerToolsCapability",
  McpUiInitializeResultHostCapabilitiesServerResources:
    "ServerResourcesCapability",
  McpUiInitializeRequestParamsAppCapabilities: "McpUiAppCapabilities",
  McpUiInitializeRequestParamsAppCapabilitiesTools: "AppToolsCapability",
  McpUiInitializeResultHostContext: "McpUiHostContext",
  McpUiHostContextChangedNotificationParams: "McpUiHostContext",
  McpUiInitializeResultHostContextTheme: "McpUiTheme",
  McpUiHostContextChangedNotificationParamsTheme: "McpUiTheme",
  McpUiInitializeResultHostContextDisplayMode: "McpUiDisplayMode",
  McpUiHostContextChangedNotificationParamsDisplayMode: "McpUiDisplayMode",
  McpUiInitializeResultHostContextPlatform: "McpUiPlatform",
  McpUiHostContextChangedNotificationParamsPlatform: "McpUiPlatform",
  McpUiInitializeResultHostContextViewport: "Viewport",
  McpUiHostContextChangedNotificationParamsViewport: "Viewport",
  McpUiInitializeResultHostContextSafeAreaInsets: "SafeAreaInsets",
  McpUiHostContextChangedNotificationParamsSafeAreaInsets: "SafeAreaInsets",
  McpUiInitializeResultHostContextDeviceCapabilities: "DeviceCapabilities",
  McpUiHostContextChangedNotificationParamsDeviceCapabilities:
    "DeviceCapabilities",
  McpUiInitializeResultHostInfo: "Implementation",
  McpUiInitializeRequestParamsAppInfo: "Implementation",
};

const HEADER_DEFINED_TYPES = new Set([
  "EmptyCapability",
  "Implementation",
  "LogLevel",
]);

const EMPTY_TYPES = new Set<string>();
const generatedTypes = new Set<string>();
const typeDefinitions: string[] = [];

function toKotlinPropertyName(name: string): string {
  return name.replace(/[.\/:]/g, "_").replace(/-/g, "_");
}

function getCanonicalName(name: string): string {
  return CANONICAL_NAMES[name] || name;
}

function isEmptyObject(schema: JsonSchema): boolean {
  return (
    schema.type === "object" &&
    schema.additionalProperties === false &&
    (!schema.properties || Object.keys(schema.properties).length === 0)
  );
}

function toKotlinType(
  schema: JsonSchema,
  contextName: string,
  defs: Record<string, JsonSchema>,
): string {
  if (schema.$ref) {
    const refName = schema.$ref.replace("#/$defs/", "");
    return getCanonicalName(refName);
  }

  if (schema.anyOf) {
    const allConsts = schema.anyOf.every((s) => s.const !== undefined);
    if (allConsts) {
      const canonical = getCanonicalName(contextName);
      if (!generatedTypes.has(canonical)) {
        generateEnum(contextName, schema);
      }
      return canonical;
    }
    return "JsonElement";
  }

  if (schema.const) {
    return "String";
  }

  switch (schema.type) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "integer":
      return "Int";
    case "boolean":
      return "Boolean";
    case "array":
      if (schema.items) {
        return `List<${toKotlinType(schema.items, contextName + "Item", defs)}>`;
      }
      return "List<JsonElement>";
    case "object":
      if (isEmptyObject(schema)) {
        EMPTY_TYPES.add(contextName);
        return "EmptyCapability";
      }
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        const canonical = getCanonicalName(contextName);
        if (!generatedTypes.has(canonical)) {
          generateDataClass(contextName, schema, defs);
        }
        return canonical;
      }
      if (schema.additionalProperties) {
        return "Map<String, JsonElement>";
      }
      return "Map<String, JsonElement>";
    default:
      return "JsonElement";
  }
}

function generateEnum(name: string, schema: JsonSchema): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  if (HEADER_DEFINED_TYPES.has(canonical)) return;
  generatedTypes.add(canonical);

  const cases = schema
    .anyOf!.filter((s) => s.const)
    .map((s) => {
      const value = s.const as string;
      const caseName = value
        .toUpperCase()
        .replace(/-/g, "_")
        .replace(/\//g, "_");
      return `    @SerialName("${value}") ${caseName}`;
    });

  const desc = schema.description ? `/** ${schema.description} */\n` : "";
  typeDefinitions.push(`${desc}@Serializable
enum class ${canonical} {
${cases.join(",\n")}
}`);
}

function generateDataClass(
  name: string,
  schema: JsonSchema,
  defs: Record<string, JsonSchema>,
): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  if (EMPTY_TYPES.has(name)) return;
  if (HEADER_DEFINED_TYPES.has(canonical)) return;
  generatedTypes.add(canonical);

  const props = schema.properties || {};
  const required = new Set(schema.required || []);

  const properties: string[] = [];

  for (const [propName, propSchema] of Object.entries(props)) {
    const kotlinName = toKotlinPropertyName(propName);
    const contextTypeName = name + capitalize(kotlinName);

    let kotlinType: string;
    if (isEmptyObject(propSchema)) {
      kotlinType = "EmptyCapability";
    } else {
      kotlinType = toKotlinType(propSchema, contextTypeName, defs);
    }

    const isOptional = !required.has(propName);
    const typeDecl = isOptional ? `${kotlinType}? = null` : kotlinType;
    const desc = propSchema.description
      ? `    /** ${propSchema.description} */\n`
      : "";
    const serialName =
      kotlinName !== propName ? `    @SerialName("${propName}")\n` : "";

    properties.push(`${desc}${serialName}    val ${kotlinName}: ${typeDecl}`);
  }

  const desc = schema.description ? `/** ${schema.description} */\n` : "";
  typeDefinitions.push(`${desc}@Serializable
data class ${canonical}(
${properties.join(",\n")}
)`);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generate(): string {
  const schema: SchemaDoc = JSON.parse(readFileSync(SCHEMA_FILE, "utf-8"));
  const defs = schema.$defs;

  const header = `// Generated from src/generated/schema.json
// DO NOT EDIT - Run: npx tsx scripts/generate-kotlin-types.ts

package io.modelcontextprotocol.apps.generated

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// MARK: - Helper Types

/** Empty capability marker (matches TypeScript \`{}\`) */
@Serializable
object EmptyCapability

/** Application/host identification */
@Serializable
data class Implementation(
    val name: String,
    val version: String,
    val title: String? = null
)

/** Log level */
@Serializable
enum class LogLevel {
    @SerialName("debug") DEBUG,
    @SerialName("info") INFO,
    @SerialName("notice") NOTICE,
    @SerialName("warning") WARNING,
    @SerialName("error") ERROR,
    @SerialName("critical") CRITICAL,
    @SerialName("alert") ALERT,
    @SerialName("emergency") EMERGENCY
}

// Type aliases for compatibility
typealias McpUiInitializeParams = McpUiInitializeRequestParams
typealias McpUiMessageParams = McpUiMessageRequestParams
typealias McpUiOpenLinkParams = McpUiOpenLinkRequestParams

// MARK: - Generated Types
`;

  for (const [name, defSchema] of Object.entries(defs)) {
    if (defSchema.anyOf && defSchema.anyOf.every((s) => s.const)) {
      generateEnum(name, defSchema);
    } else if (defSchema.type === "object") {
      generateDataClass(name, defSchema, defs);
    }
  }

  return header + "\n" + typeDefinitions.join("\n\n") + "\n";
}

try {
  console.log("🔧 Generating Kotlin types from schema.json...");
  const code = generate();

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, code);

  console.log(`✅ Generated: ${OUTPUT_FILE}`);
  console.log(`   Types: ${generatedTypes.size}`);
} catch (error) {
  console.error("❌ Generation failed:", error);
  process.exit(1);
}
