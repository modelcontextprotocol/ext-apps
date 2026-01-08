#!/usr/bin/env npx tsx
/**
 * Generate Swift types from MCP Apps JSON Schema
 *
 * This generator:
 * 1. Identifies structurally equivalent types and deduplicates them
 * 2. Uses simpler names for common patterns
 * 3. Creates type aliases for compatibility
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..");
const SCHEMA_FILE = join(PROJECT_DIR, "src/generated/schema.json");
const OUTPUT_FILE = join(
  PROJECT_DIR,
  "swift/Sources/McpApps/Generated/SchemaTypes.swift",
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
}

interface SchemaDoc {
  $defs: Record<string, JsonSchema>;
}

// Types defined in the header that should not be regenerated
const HEADER_DEFINED_TYPES = new Set([
  "EmptyCapability",
  "AnyCodable",
  "Implementation",
  "TextContent",
  "LogLevel",
  "HostOptions",
  "CspConfig",
]);

// Canonical type names - map verbose inline names to simpler ones
const CANONICAL_NAMES: Record<string, string> = {
  // Capabilities
  McpUiInitializeResultHostCapabilities: "McpUiHostCapabilities",
  McpUiInitializeResultHostCapabilitiesServerTools: "ServerToolsCapability",
  McpUiInitializeResultHostCapabilitiesServerResources:
    "ServerResourcesCapability",
  McpUiInitializeRequestParamsAppCapabilities: "McpUiAppCapabilities",
  McpUiInitializeRequestParamsAppCapabilitiesTools: "AppToolsCapability",
  McpUiHostContextChangedNotificationParamsDeviceCapabilities:
    "DeviceCapabilities",
  McpUiInitializeResultHostContextDeviceCapabilities: "DeviceCapabilities",

  // Context types
  McpUiInitializeResultHostContext: "McpUiHostContext",
  McpUiHostContextChangedNotificationParams: "McpUiHostContext",

  // Enums
  McpUiInitializeResultHostContextTheme: "McpUiTheme",
  McpUiHostContextChangedNotificationParamsTheme: "McpUiTheme",
  McpUiInitializeResultHostContextDisplayMode: "McpUiDisplayMode",
  McpUiHostContextChangedNotificationParamsDisplayMode: "McpUiDisplayMode",
  McpUiInitializeResultHostContextPlatform: "McpUiPlatform",
  McpUiHostContextChangedNotificationParamsPlatform: "McpUiPlatform",

  // Viewport
  McpUiInitializeResultHostContextViewport: "Viewport",
  McpUiHostContextChangedNotificationParamsViewport: "Viewport",

  // Safe area
  McpUiInitializeResultHostContextSafeAreaInsets: "SafeAreaInsets",
  McpUiHostContextChangedNotificationParamsSafeAreaInsets: "SafeAreaInsets",

  // Implementation
  McpUiInitializeResultHostInfo: "Implementation",
  McpUiInitializeRequestParamsAppInfo: "Implementation",
};

// Types to skip (will use the canonical version)
const SKIP_TYPES = new Set(Object.keys(CANONICAL_NAMES));

// Empty object types
const EMPTY_TYPES = new Set<string>();

// Track generated types
const generatedTypes = new Set<string>();
const typeDefinitions: string[] = [];

function toSwiftPropertyName(name: string): string {
  // Replace invalid Swift identifier characters
  return name
    .replace(/[.\/:]/g, "_")
    .replace(/-/g, "_")
    .replace(/^_+/, "") // Remove leading underscores
    .replace(/_+$/, ""); // Remove trailing underscores
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

// Check if anyOf represents a discriminated union (objects with "type" const field)
function isDiscriminatedUnion(variants: JsonSchema[]): boolean {
  return variants.every((v) => {
    if (v.type !== "object" || !v.properties?.type) return false;
    const typeField = v.properties.type;
    return typeField.const !== undefined || typeField.type === "string";
  });
}

// Get the discriminator value from a variant
function getDiscriminatorValue(variant: JsonSchema): string | null {
  const typeField = variant.properties?.type;
  if (typeField?.const) return typeField.const as string;
  return null;
}

// Check if anyOf is a field-based union (differentiated by presence of fields like text/blob)
function isFieldBasedUnion(variants: JsonSchema[]): string | null {
  if (variants.length !== 2) return null;

  // Find the differentiating required field
  const req0 = new Set(variants[0].required || []);
  const req1 = new Set(variants[1].required || []);

  // Find fields unique to each variant
  const unique0 = [...req0].filter((f) => !req1.has(f));
  const unique1 = [...req1].filter((f) => !req0.has(f));

  if (unique0.length === 1 && unique1.length === 1) {
    return `${unique0[0]}|${unique1[0]}`;
  }
  return null;
}

// Generate Swift enum for field-based union (e.g., text vs blob)
function generateFieldBasedUnion(
  name: string,
  variants: JsonSchema[],
  fields: string,
  defs: Record<string, JsonSchema>,
): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  generatedTypes.add(canonical);

  const [field0, field1] = fields.split("|");
  const case0 = field0.replace(/-/g, "");
  const case1 = field1.replace(/-/g, "");
  const struct0 = canonical + capitalize(case0);
  const struct1 = canonical + capitalize(case1);

  // Generate the associated structs
  generateStruct(struct0, variants[0], defs);
  generateStruct(struct1, variants[1], defs);

  typeDefinitions.push(`public enum ${canonical}: Codable, Sendable, Equatable {
    case ${case0}(${struct0})
    case ${case1}(${struct1})

    public init(from decoder: Decoder) throws {
        // Try decoding each variant
        if let v = try? ${struct0}(from: decoder) {
            self = .${case0}(v)
        } else if let v = try? ${struct1}(from: decoder) {
            self = .${case1}(v)
        } else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Cannot decode ${canonical}"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .${case0}(let v): try v.encode(to: encoder)
        case .${case1}(let v): try v.encode(to: encoder)
        }
    }
}`);
}

// Generate Swift enum for discriminated union
function generateDiscriminatedUnion(
  name: string,
  variants: JsonSchema[],
  defs: Record<string, JsonSchema>,
): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  generatedTypes.add(canonical);

  const cases: string[] = [];
  const decodeCases: string[] = [];
  const encodeCases: string[] = [];

  for (const variant of variants) {
    const discriminator = getDiscriminatorValue(variant);
    if (!discriminator) continue;

    const caseName = discriminator.replace(/-/g, "").replace(/_/g, "");
    const structName = canonical + capitalize(caseName);

    // Generate the associated struct
    generateStruct(structName, variant, defs);

    cases.push(`    case ${caseName}(${structName})`);
    decodeCases.push(
      `        case "${discriminator}": self = .${caseName}(try ${structName}(from: decoder))`,
    );
    encodeCases.push(
      `        case .${caseName}(let v): try v.encode(to: encoder)`,
    );
  }

  typeDefinitions.push(`public enum ${canonical}: Codable, Sendable, Equatable {
${cases.join("\n")}

    private enum CodingKeys: String, CodingKey {
        case type
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
${decodeCases.join("\n")}
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown type: \\(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
${encodeCases.join("\n")}
        }
    }
}`);
}

function toSwiftType(
  schema: JsonSchema,
  contextName: string,
  defs: Record<string, JsonSchema>,
): string {
  if (schema.$ref) {
    const refName = schema.$ref.replace("#/$defs/", "");
    return getCanonicalName(refName);
  }

  if (schema.anyOf) {
    // Check if it's a simple string enum (all const strings)
    const allConsts = schema.anyOf.every((s) => s.const !== undefined);
    if (allConsts) {
      const canonical = getCanonicalName(contextName);
      if (!generatedTypes.has(canonical)) {
        generateEnum(contextName, schema);
      }
      return canonical;
    }

    // Check if it's a discriminated union (objects with "type" const field)
    const discriminatedUnion = isDiscriminatedUnion(schema.anyOf);
    if (discriminatedUnion) {
      const canonical = getCanonicalName(contextName);
      if (!generatedTypes.has(canonical)) {
        generateDiscriminatedUnion(contextName, schema.anyOf, defs);
      }
      return canonical;
    }

    // Check if it's a field-based union (e.g., text vs blob)
    const fieldUnion = isFieldBasedUnion(schema.anyOf);
    if (fieldUnion) {
      const canonical = getCanonicalName(contextName);
      if (!generatedTypes.has(canonical)) {
        generateFieldBasedUnion(contextName, schema.anyOf, fieldUnion, defs);
      }
      return canonical;
    }

    return "AnyCodable";
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
      return "Bool";
    case "array":
      if (schema.items) {
        return `[${toSwiftType(schema.items, contextName + "Item", defs)}]`;
      }
      return "[AnyCodable]";
    case "object":
      if (isEmptyObject(schema)) {
        EMPTY_TYPES.add(contextName);
        return "EmptyCapability";
      }
      // If it has properties defined, generate a struct (even with additionalProperties)
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        const canonical = getCanonicalName(contextName);
        if (!generatedTypes.has(canonical)) {
          generateStruct(contextName, schema, defs);
        }
        return canonical;
      }
      // Handle typed additionalProperties (e.g., Record<string, SomeType>)
      if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object" &&
        Object.keys(schema.additionalProperties).length > 0
      ) {
        const valueType = toSwiftType(
          schema.additionalProperties,
          contextName + "Value",
          defs,
        );
        return `[String: ${valueType}]`;
      }
      // Fallback to [String: AnyCodable] for open objects
      if (schema.additionalProperties || !schema.properties) {
        return "[String: AnyCodable]";
      }
      const canonical = getCanonicalName(contextName);
      if (!generatedTypes.has(canonical) && schema.properties) {
        generateStruct(contextName, schema, defs);
      }
      return canonical;
    default:
      return "AnyCodable";
  }
}

function generateEnum(name: string, schema: JsonSchema): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  generatedTypes.add(canonical);

  const cases = schema
    .anyOf!.filter((s) => s.const)
    .map((s) => {
      const value = s.const!;
      const caseName = value.replace(/-/g, "").replace(/\//g, "");
      return `    case ${caseName} = "${value}"`;
    });

  const desc = schema.description ? `/// ${schema.description}\n` : "";
  typeDefinitions.push(`${desc}public enum ${canonical}: String, Codable, Sendable, Equatable {
${cases.join("\n")}
}`);
}

function generateStruct(
  name: string,
  schema: JsonSchema,
  defs: Record<string, JsonSchema>,
): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  if (EMPTY_TYPES.has(name)) return;
  if (HEADER_DEFINED_TYPES.has(canonical)) return; // Defined in header
  generatedTypes.add(canonical);

  const props = schema.properties || {};
  const required = new Set(schema.required || []);

  const properties: Array<{
    swiftName: string;
    jsonName: string;
    type: string;
    isOptional: boolean;
    description?: string;
  }> = [];

  for (const [propName, propSchema] of Object.entries(props)) {
    const swiftName = toSwiftPropertyName(propName);
    const contextTypeName = name + capitalize(swiftName);

    let swiftType: string;
    if (isEmptyObject(propSchema)) {
      swiftType = "EmptyCapability";
    } else {
      swiftType = toSwiftType(propSchema, contextTypeName, defs);
    }

    properties.push({
      swiftName,
      jsonName: propName,
      type: swiftType,
      isOptional: !required.has(propName),
      description: propSchema.description,
    });
  }

  const propLines = properties
    .map((p) => {
      const desc = p.description ? `    /// ${p.description}\n` : "";
      const typeDecl = p.isOptional ? `${p.type}?` : p.type;
      return `${desc}    public var ${p.swiftName}: ${typeDecl}`;
    })
    .join("\n");

  const needsCodingKeys = properties.some((p) => p.swiftName !== p.jsonName);
  let codingKeys = "";
  if (needsCodingKeys) {
    const keyLines = properties
      .map((p) =>
        p.swiftName !== p.jsonName
          ? `        case ${p.swiftName} = "${p.jsonName}"`
          : `        case ${p.swiftName}`,
      )
      .join("\n");
    codingKeys = `

    private enum CodingKeys: String, CodingKey {
${keyLines}
    }`;
  }

  const initParams = properties
    .map((p) => {
      const defaultValue = p.isOptional ? " = nil" : "";
      return `        ${p.swiftName}: ${p.isOptional ? p.type + "?" : p.type}${defaultValue}`;
    })
    .join(",\n");

  const initAssignments = properties
    .map((p) => `        self.${p.swiftName} = ${p.swiftName}`)
    .join("\n");

  const desc = schema.description ? `/// ${schema.description}\n` : "";
  typeDefinitions.push(`${desc}public struct ${canonical}: Codable, Sendable, Equatable {
${propLines}${codingKeys}

    public init(
${initParams}
    ) {
${initAssignments}
    }
}`);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generate(): string {
  const schema: SchemaDoc = JSON.parse(readFileSync(SCHEMA_FILE, "utf-8"));
  const defs = schema.$defs;

  const header = `// Generated from src/generated/schema.json
// DO NOT EDIT - Run: npx tsx scripts/generate-swift-types.ts

import Foundation

// MARK: - Helper Types

/// Empty capability marker (matches TypeScript \`{}\`)
public struct EmptyCapability: Codable, Sendable, Equatable {
    public init() {}
}

/// Type-erased value for dynamic JSON
public struct AnyCodable: Codable, Equatable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self.value = NSNull() }
        else if let bool = try? container.decode(Bool.self) { self.value = bool }
        else if let int = try? container.decode(Int.self) { self.value = int }
        else if let double = try? container.decode(Double.self) { self.value = double }
        else if let string = try? container.decode(String.self) { self.value = string }
        else if let array = try? container.decode([AnyCodable].self) { self.value = array.map { $0.value } }
        else if let dict = try? container.decode([String: AnyCodable].self) { self.value = dict.mapValues { $0.value } }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode") }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull: try container.encodeNil()
        case let v as Bool: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as String: try container.encode(v)
        case let v as [Any]: try container.encode(v.map { AnyCodable($0) })
        case let v as [String: Any]: try container.encode(v.mapValues { AnyCodable($0) })
        default: throw EncodingError.invalidValue(value, .init(codingPath: [], debugDescription: "Cannot encode"))
        }
    }

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case is (NSNull, NSNull): return true
        case let (l as Bool, r as Bool): return l == r
        case let (l as Int, r as Int): return l == r
        case let (l as Double, r as Double): return l == r
        case let (l as String, r as String): return l == r
        default: return false
        }
    }
}

/// Application/host identification
public struct Implementation: Codable, Sendable, Equatable {
    public var name: String
    public var version: String
    public var title: String?

    public init(name: String, version: String, title: String? = nil) {
        self.name = name
        self.version = version
        self.title = title
    }
}

/// Text content block
public struct TextContent: Codable, Sendable {
    public var type: String = "text"
    public var text: String
    public init(text: String) { self.text = text }
}

/// Log level
public enum LogLevel: String, Codable, Sendable {
    case debug, info, notice, warning, error, critical, alert, emergency
}

/// Host options
public struct HostOptions: Sendable {
    public var hostContext: McpUiHostContext
    public init(hostContext: McpUiHostContext = McpUiHostContext()) {
        self.hostContext = hostContext
    }
}

/// CSP configuration
public struct CspConfig: Codable, Sendable {
    public var connectDomains: [String]?
    public var resourceDomains: [String]?
    public init(connectDomains: [String]? = nil, resourceDomains: [String]? = nil) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

// MARK: - Type Aliases for Compatibility

public typealias McpUiInitializeParams = McpUiInitializeRequestParams
public typealias McpUiMessageParams = McpUiMessageRequestParams
public typealias McpUiOpenLinkParams = McpUiOpenLinkRequestParams
public typealias ServerToolsCapability = McpUiHostCapabilitiesServerTools
public typealias ServerResourcesCapability = McpUiHostCapabilitiesServerResources
public typealias AppToolsCapability = McpUiAppCapabilitiesTools
public typealias ContentBlock = McpUiMessageRequestParamsContentItem
public typealias CallToolResult = McpUiToolResultNotificationParams
public typealias ResourceContent = McpUiMessageRequestParamsContentItemResourceResource

// MARK: - Generated Types
`;

  // Process all definitions in order
  for (const [name, defSchema] of Object.entries(defs)) {
    if (defSchema.anyOf && defSchema.anyOf.every((s) => s.const)) {
      generateEnum(name, defSchema);
    } else if (defSchema.type === "object") {
      generateStruct(name, defSchema, defs);
    }
  }

  return header + "\n" + typeDefinitions.join("\n\n") + "\n";
}

try {
  console.log("🔧 Generating Swift types from schema.json...");
  const code = generate();

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, code);

  console.log(`✅ Generated: ${OUTPUT_FILE}`);
  console.log(`   Types: ${generatedTypes.size}`);
  console.log(
    `   Deduplicated: ${Object.keys(CANONICAL_NAMES).length} inline types`,
  );
} catch (error) {
  console.error("❌ Generation failed:", error);
  process.exit(1);
}
