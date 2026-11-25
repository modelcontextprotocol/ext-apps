/**
 * Static (no-rendering) validation of an MCP App server: inspects
 * `tools/list`, `resources/list`, and `resources/read` responses against the
 * app-side requirements catalogue in `rules.ts`.
 *
 * @module validator
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";

import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "../app.js";
import { McpUiResourceMetaSchema, McpUiToolMetaSchema } from "../types.js";
import { makeFinding, type Finding } from "./report.js";
import type { RuleId } from "./rules.js";

/** Rule ids exercised by {@link validateServerStatically}. */
export const STATIC_RULE_IDS: RuleId[] = [
  "APP-001",
  "APP-002",
  "APP-003",
  "APP-004",
  "APP-005",
  "APP-006",
  "APP-007",
  "APP-008",
  "APP-009",
  "APP-011",
];

interface UiToolRef {
  tool: Tool;
  resourceUri: string;
}

/** A fetched UI resource with its findings-relevant fields. */
export interface FetchedUiResource {
  uri: string;
  html?: string;
}

function getUiMeta(tool: Tool): Record<string, unknown> | undefined {
  return tool._meta?.ui as Record<string, unknown> | undefined;
}

function getLegacyUri(tool: Tool): string | undefined {
  return tool._meta?.[RESOURCE_URI_META_KEY] as string | undefined;
}

/** Extract every tool that declares a UI resource, in either metadata format. */
export function collectUiTools(tools: Tool[]): UiToolRef[] {
  const refs: UiToolRef[] = [];
  for (const tool of tools) {
    const resourceUri =
      (getUiMeta(tool)?.resourceUri as string | undefined) ??
      getLegacyUri(tool);
    if (resourceUri !== undefined) {
      refs.push({ tool, resourceUri });
    }
  }
  return refs;
}

const ORIGIN_PATTERN = /^(https?|wss?):\/\/(\*\.)?[^\s/*]+$/;

function checkCspDomains(
  csp: Record<string, unknown> | undefined,
  subject: string,
  findings: Finding[],
): void {
  if (!csp) return;
  for (const [key, value] of Object.entries(csp)) {
    if (!Array.isArray(value)) continue;
    for (const domain of value) {
      if (typeof domain !== "string" || !ORIGIN_PATTERN.test(domain)) {
        findings.push(
          makeFinding(
            "APP-009",
            `csp.${key} entry ${JSON.stringify(domain)} is not a well-formed origin (expected e.g. "https://api.example.com" or "https://*.example.com")`,
            subject,
          ),
        );
      }
    }
  }
}

function checkResourceMeta(
  meta: unknown,
  subject: string,
  findings: Finding[],
): void {
  if (meta === undefined) return;
  const parsed = McpUiResourceMetaSchema.safeParse(meta);
  if (!parsed.success) {
    findings.push(
      makeFinding(
        "APP-008",
        `_meta.ui does not match the UIResourceMeta schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
        subject,
      ),
    );
    return;
  }
  checkCspDomains(
    (meta as { csp?: Record<string, unknown> }).csp,
    subject,
    findings,
  );
}

/**
 * Cheap structural HTML5 sanity check. This intentionally does not attempt
 * full HTML validation — it catches the failure modes that break rendering
 * outright (empty content, JSON or plain text served as HTML).
 */
export function looksLikeHtmlDocument(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;
  const head = trimmed.slice(0, 1024).toLowerCase();
  return head.startsWith("<!doctype html") || /<html[\s>]/.test(head);
}

export interface StaticValidationResult {
  findings: Finding[];
  /** Successfully fetched UI resources, for downstream behavioral checks. */
  resources: FetchedUiResource[];
}

/**
 * Run all static app-side checks against a connected MCP client.
 *
 * The client must already be initialized (with the MCP Apps extension
 * capability advertised, so the server registers its UI-enabled tools).
 */
export async function validateServerStatically(
  client: Pick<Client, "listTools" | "listResources" | "readResource">,
): Promise<StaticValidationResult> {
  const findings: Finding[] = [];

  const { tools } = await client.listTools();
  let listedResources: Resource[] = [];
  try {
    listedResources = (await client.listResources()).resources;
  } catch {
    // Servers MAY omit UI-only resources from resources/list entirely, and
    // some don't implement resources/list at all. Not a finding by itself.
  }

  // Listing-level resource checks (uri scheme + mimeType + _meta.ui shape).
  for (const resource of listedResources) {
    const isUiUri = resource.uri.startsWith("ui://");
    const uiMeta = (resource._meta as { ui?: unknown } | undefined)?.ui;
    if (
      !isUiUri &&
      (uiMeta !== undefined || resource.mimeType === RESOURCE_MIME_TYPE)
    ) {
      findings.push(
        makeFinding(
          "APP-001",
          `resource declares UI metadata or the MCP App MIME type but its URI does not use the ui:// scheme`,
          resource.uri,
        ),
      );
    }
    if (isUiUri) {
      if (resource.mimeType !== RESOURCE_MIME_TYPE) {
        findings.push(
          makeFinding(
            "APP-002",
            `listed mimeType is ${JSON.stringify(resource.mimeType)}, expected "${RESOURCE_MIME_TYPE}"`,
            resource.uri,
          ),
        );
      }
      checkResourceMeta(uiMeta, resource.uri, findings);
    }
  }

  // Tool-level checks.
  const uiTools = collectUiTools(tools);
  const referencedUris = new Set<string>();
  for (const { tool, resourceUri } of uiTools) {
    referencedUris.add(resourceUri);
    const subject = `tool ${tool.name}`;

    if (!resourceUri.startsWith("ui://")) {
      findings.push(
        makeFinding(
          "APP-001",
          `referenced UI resource URI ${JSON.stringify(resourceUri)} does not use the ui:// scheme`,
          subject,
        ),
      );
    }

    const uiMeta = getUiMeta(tool);
    // The SDK's registerAppTool mirrors the modern key into the legacy one
    // for host compatibility, so only a tool with no modern key is actually
    // relying on the deprecated format.
    if (getLegacyUri(tool) !== undefined && uiMeta?.resourceUri === undefined) {
      findings.push(
        makeFinding(
          "APP-006",
          `uses the deprecated flat _meta["${RESOURCE_URI_META_KEY}"] key; use _meta.ui.resourceUri (the flat key will be removed before GA)`,
          subject,
        ),
      );
    }

    if (uiMeta !== undefined) {
      // Report bad visibility entries under the dedicated rule (APP-011),
      // then everything else the schema catches under APP-007.
      if (Array.isArray(uiMeta.visibility)) {
        for (const entry of uiMeta.visibility) {
          if (entry !== "model" && entry !== "app") {
            findings.push(
              makeFinding(
                "APP-011",
                `visibility entry ${JSON.stringify(entry)} is not one of "model" | "app"`,
                subject,
              ),
            );
          }
        }
      }
      const parsed = McpUiToolMetaSchema.safeParse(uiMeta);
      if (!parsed.success) {
        const issues = parsed.error.issues.filter(
          (issue) => issue.path[0] !== "visibility",
        );
        if (issues.length > 0) {
          findings.push(
            makeFinding(
              "APP-007",
              `_meta.ui does not match the McpUiToolMeta schema: ${issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}`,
              subject,
            ),
          );
        }
      }
    }
  }

  // Read every referenced UI resource: existence + content checks.
  const fetched: FetchedUiResource[] = [];
  for (const uri of referencedUris) {
    let contents;
    try {
      contents = (await client.readResource({ uri })).contents;
    } catch (error) {
      // The SDK client validates resources/read responses, so a content item
      // that violates the text-or-blob requirement surfaces here as a schema
      // error rather than as inspectable data.
      const issues = JSON.stringify(
        (error as { issues?: unknown }).issues ?? "",
      );
      if (issues.includes('["text"]') && issues.includes('["blob"]')) {
        findings.push(
          makeFinding(
            "APP-003",
            `resources/read returned content providing neither text nor blob`,
            uri,
          ),
        );
      } else {
        findings.push(
          makeFinding(
            "APP-005",
            `resources/read failed for tool-referenced resource: ${error instanceof Error ? error.message : String(error)}`,
            uri,
          ),
        );
      }
      continue;
    }

    if (contents.length === 0) {
      findings.push(
        makeFinding("APP-005", `resources/read returned no contents`, uri),
      );
      continue;
    }

    for (const content of contents) {
      if (content.mimeType !== RESOURCE_MIME_TYPE) {
        findings.push(
          makeFinding(
            "APP-002",
            `content mimeType is ${JSON.stringify(content.mimeType)}, expected "${RESOURCE_MIME_TYPE}"`,
            uri,
          ),
        );
      }

      const { text, blob } = content as {
        text?: string;
        blob?: string;
      };
      if (text === undefined && blob === undefined) {
        findings.push(
          makeFinding("APP-003", `content provides neither text nor blob`, uri),
        );
        continue;
      }

      const html =
        text ?? Buffer.from(blob as string, "base64").toString("utf-8");
      if (!looksLikeHtmlDocument(html)) {
        findings.push(
          makeFinding(
            "APP-004",
            `content does not look like an HTML5 document (no <!doctype html> or <html> in the first 1024 bytes)`,
            uri,
          ),
        );
      } else {
        fetched.push({ uri, html });
      }

      checkResourceMeta(
        (content._meta as { ui?: unknown } | undefined)?.ui,
        uri,
        findings,
      );
    }
  }

  return { findings, resources: fetched };
}
