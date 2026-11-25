/**
 * MCP App validator: checks an MCP Apps server (or a standalone app HTML
 * document) against the app-side requirements of the MCP Apps specification.
 *
 * Static checks inspect `tools/list` / `resources/list` / `resources/read`
 * responses; behavioral checks load the app under a mock host in a headless
 * browser (requires playwright). See `rules.ts` for the requirements
 * catalogue; every finding cites the rule and spec section it derives from.
 *
 * @example
 * ```ts
 * import { validateApp } from "@modelcontextprotocol/ext-apps/validator";
 *
 * const report = await validateApp({ url: "http://localhost:3001/mcp" });
 * console.log(report.findings);
 * ```
 *
 * @module validator
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { RESOURCE_MIME_TYPE } from "../app.js";
import { EXTENSION_ID } from "../server/index.js";
import {
  BEHAVIORAL_RULE_IDS,
  validateAppBehavior,
  type BehavioralOptions,
} from "./harness.js";
import type { ValidationReport } from "./report.js";
import {
  STATIC_RULE_IDS,
  validateServerStatically,
  looksLikeHtmlDocument,
  type FetchedUiResource,
} from "./static.js";

export * from "./rules.js";
export * from "./report.js";
export {
  STATIC_RULE_IDS,
  BEHAVIORAL_RULE_IDS,
  validateServerStatically,
  validateAppBehavior,
};
export type { BehavioralOptions } from "./harness.js";
export type { FetchedUiResource, StaticValidationResult } from "./static.js";

/** What to validate. Exactly one of the members must be provided. */
export type ValidationTarget =
  | { /** Streamable HTTP endpoint of an MCP server. */ url: string }
  | {
      /** Command (argv) to spawn an MCP server over stdio. */ command: string[];
    }
  | {
      /** Raw app HTML, validated behaviorally only. */ html: string;
      label?: string;
    };

export interface ValidateAppOptions {
  /** Run behavioral checks (default true; skipped with a note if playwright is unavailable). */
  behavioral?: boolean;
  behavioralOptions?: BehavioralOptions;
}

async function connectClient(
  target: { url: string } | { command: string[] },
): Promise<Client> {
  const client = new Client(
    { name: "mcp-app-validator", version: "0.1.0" },
    {
      capabilities: {
        // Advertise MCP Apps support so servers register their UI-enabled
        // tools (spec: servers SHOULD check client capabilities first).
        extensions: {
          [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
        },
      } as never,
    },
  );

  if ("url" in target) {
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    await client.connect(
      new StreamableHTTPClientTransport(new URL(target.url)),
    );
  } else {
    const { StdioClientTransport } =
      await import("@modelcontextprotocol/sdk/client/stdio.js");
    const [command, ...args] = target.command;
    await client.connect(new StdioClientTransport({ command, args }));
  }
  return client;
}

async function runBehavioral(
  resources: FetchedUiResource[],
  report: ValidationReport,
  options: ValidateAppOptions,
): Promise<void> {
  if (options.behavioral === false) {
    report.skippedRules.push(
      ...BEHAVIORAL_RULE_IDS.map((id) => ({
        id,
        reason: "behavioral checks disabled",
      })),
    );
    return;
  }
  for (const resource of resources) {
    if (!resource.html) continue;
    try {
      report.findings.push(
        ...(await validateAppBehavior(
          resource.html,
          resource.uri,
          options.behavioralOptions,
        )),
      );
    } catch (error) {
      report.skippedRules.push(
        ...BEHAVIORAL_RULE_IDS.map((id) => ({
          id,
          reason: error instanceof Error ? error.message : String(error),
        })),
      );
      return;
    }
  }
  report.checkedRules.push(...BEHAVIORAL_RULE_IDS);
}

/** Validate an MCP Apps server or a standalone app HTML document. */
export async function validateApp(
  target: ValidationTarget,
  options: ValidateAppOptions = {},
): Promise<ValidationReport> {
  if ("html" in target) {
    const report: ValidationReport = {
      target: target.label ?? "<html document>",
      findings: [],
      checkedRules: [],
      skippedRules: STATIC_RULE_IDS.map((id) => ({
        id,
        reason: "server-level rule; target is a standalone HTML document",
      })),
    };
    if (!looksLikeHtmlDocument(target.html)) {
      report.findings.push({
        rule: (await import("./rules.js")).getRule("APP-004"),
        message:
          "content does not look like an HTML5 document (no <!doctype html> or <html> in the first 1024 bytes)",
        subject: report.target,
      });
    }
    report.checkedRules.push("APP-004");
    await runBehavioral(
      [{ uri: report.target, html: target.html }],
      report,
      options,
    );
    return report;
  }

  const targetLabel = "url" in target ? target.url : target.command.join(" ");
  const client = await connectClient(target);
  try {
    const { findings, resources } = await validateServerStatically(client);
    const report: ValidationReport = {
      target: targetLabel,
      findings,
      checkedRules: [...STATIC_RULE_IDS],
      skippedRules: [
        {
          id: "APP-010",
          reason:
            "requires invoking tools (potential side effects); not run automatically",
        },
      ],
    };
    if (resources.length === 0) {
      report.skippedRules.push(
        ...BEHAVIORAL_RULE_IDS.map((id) => ({
          id,
          reason: "no UI resources fetched from the server",
        })),
      );
    } else {
      await runBehavioral(resources, report, options);
    }
    return report;
  } finally {
    await client.close();
  }
}
