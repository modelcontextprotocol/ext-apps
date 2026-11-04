import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import ABCJS from "abcjs";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
// Works both from source (server.ts) and compiled (dist/server.js). Derived
// from import.meta.url rather than import.meta.filename/dirname, which are
// undefined on Node older than 20.11.
const SERVER_FILE = fileURLToPath(import.meta.url);
const DIST_DIR = SERVER_FILE.endsWith(".ts")
  ? path.join(path.dirname(SERVER_FILE), "dist")
  : path.dirname(SERVER_FILE);

const DEFAULT_ABC_NOTATION_INPUT = `X:1
T:Twinkle, Twinkle Little Star
M:4/4
L:1/4
K:C
C C G G | A A G2 | F F E E | D D C2 |
G G F F | E E D2 | G G F F | E E D2 |
C C G G | A A G2 | F F E E | D D C2 |`;

// File Uploads extension (working draft): how a file reaches a tool.
// This server takes files inline only, up to this size.
const FILES_EXTENSION_ID = "io.modelcontextprotocol/files";
const MAX_ABC_FILE_BYTES = 256 * 1024;

// A file argument, as the File Uploads extension defines it (`FileInput`)
const AbcFileSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    mimeType: z.string(),
    size: z.number().int().nonnegative(),
    digest: z.object({ algorithm: z.literal("sha-256"), value: z.string() }),
    data: z.string().optional(),
  })
  .meta({
    "x-mcp-file": {
      accept: [".abc", "text/vnd.abc"],
      maxSize: MAX_ABC_FILE_BYTES,
    },
  });

/**
 * Parses ABC notation with abcjs, and returns an error message if it is invalid.
 */
function validateAbcNotation(abcNotation: string): string | undefined {
  const [{ warnings }] = ABCJS.parseOnly(abcNotation);

  // abcjs reports errors as warnings
  if (warnings && warnings.length > 0) {
    // Strip HTML markup from warning messages
    const messages = warnings.map((w) => w.replace(/<[^>]*>/g, ""));
    return `Invalid ABC notation:\n${messages.join("\n")}`;
  }
  return undefined;
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/**
 * Creates a new MCP server instance with the sheet music tools and resource.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "Sheet Music Server",
      version: "1.0.0",
    },
    {
      capabilities: {
        extensions: {
          [FILES_EXTENSION_ID]: { maxInlineBytes: MAX_ABC_FILE_BYTES },
        },
      },
    },
  );

  const resourceUri = "ui://sheet-music/mcp-app.html";

  // Register the play-sheet-music tool.
  // Validates ABC notation server-side, then the client renders via ontoolinput.
  registerAppTool(
    server,
    "play-sheet-music",
    {
      title: "Play Sheet Music",
      description:
        "Plays music from ABC notation with audio playback and visual sheet music. " +
        "Use this to compose original songs (for birthdays, holidays, or any occasion) " +
        "or perform well-known tunes (folk songs, nursery rhymes, hymns, classical melodies). " +
        "For accurate renditions of well-known tunes, look up the ABC notation from " +
        "abcnotation.com or thesession.org rather than recalling from memory.",
      inputSchema: z.object({
        abcNotation: z
          .string()
          .default(DEFAULT_ABC_NOTATION_INPUT)
          .describe(
            "ABC notation string to render as sheet music with audio playback",
          ),
      }),
      _meta: { ui: { resourceUri } },
    },
    async ({ abcNotation }): Promise<CallToolResult> => {
      const error = validateAbcNotation(abcNotation);
      if (error) return toolError(error);

      return {
        content: [{ type: "text", text: "Input parsed successfully." }],
      };
    },
  );

  // Register the play-sheet-music-file tool, which a host calls when the user
  // opens an ABC file ("file" entrypoint). The file is the one argument, and
  // the notation reaches the View in the result: the View's tool input may
  // come without the file's bytes.
  registerAppTool(
    server,
    "play-sheet-music-file",
    {
      title: "Play Sheet Music File",
      description:
        "Shows an ABC notation file (.abc) as sheet music with audio playback.",
      inputSchema: z.object({
        file: AbcFileSchema.describe("The ABC notation file to open"),
      }),
      outputSchema: z.object({ abcNotation: z.string() }),
      annotations: { readOnlyHint: true },
      _meta: {
        ui: {
          resourceUri,
          entrypoints: [
            { type: "file", extensions: [".abc"], mimeTypes: ["text/vnd.abc"] },
          ],
        },
      },
    },
    async ({ file }): Promise<CallToolResult> => {
      if (file.data === undefined) {
        return toolError("This server only takes a file's bytes inline.");
      }

      // The metadata is the client's claim: check it against the bytes
      const bytes = Buffer.from(file.data, "base64");
      if (bytes.length > MAX_ABC_FILE_BYTES) {
        return toolError(`File too large (max ${MAX_ABC_FILE_BYTES} bytes).`);
      }
      const digest = createHash("sha256").update(bytes).digest("base64url");
      if (bytes.length !== file.size || digest !== file.digest.value) {
        return toolError(
          "The file does not match its declared size or digest.",
        );
      }

      const abcNotation = bytes.toString("utf-8");
      const error = validateAbcNotation(abcNotation);
      if (error) return toolError(error);

      return {
        content: [
          { type: "text", text: `Opened ${file.name ?? "an ABC file"}.` },
        ],
        structuredContent: { abcNotation },
      };
    },
  );

  // Register the UI resource that serves the bundled HTML/JS/CSS.
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE, description: "Sheet Music Viewer UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  // Allow loading soundfonts for audio playback
                  connectDomains: ["https://paulrosen.github.io"],
                },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}
