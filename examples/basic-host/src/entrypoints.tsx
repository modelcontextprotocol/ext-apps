/**
 * The tools that the user can open from this host's own UI, without the
 * agent: those whose server declares an entrypoint (`_meta.ui.entrypoints`).
 */
import { fileMatchesEntrypoint, getToolEntrypoints, getToolFileArgument } from "@modelcontextprotocol/ext-apps/app-bridge";
import { getDisplayName, type Tool } from "@modelcontextprotocol/client";
import { use, useMemo, useRef, useState } from "react";
import { callTool, log, type ServerInfo, type ToolCallInfo } from "./implementation";
import styles from "./index.module.css";

/** The File Uploads extension, which defines how a file reaches a tool. */
const FILES_EXTENSION_ID = "io.modelcontextprotocol/files";

/** Largest file sent to a server that does not advertise its own `maxInlineBytes`. */
const DEFAULT_MAX_INLINE_BYTES = 256 * 1024;

interface Entrypoint {
  server: ServerInfo;
  tool: Tool;
}

/**
 * List the tools that declare a `"global"` or `"thread"` entrypoint. Both open
 * with no arguments, so a tool whose input schema has required properties is
 * left out, whatever it declares.
 *
 * This host makes the call itself, so it offers a tool whatever its `visibility`.
 */
function listEntrypoints(servers: ServerInfo[], type: "global" | "thread"): Entrypoint[] {
  return servers.flatMap((server) =>
    Array.from(server.tools.values())
      .filter((tool) => {
        if (!getToolEntrypoints(tool).some((entrypoint) => entrypoint.type === type)) return false;
        if (tool.inputSchema.required?.length) {
          log.warn(`Ignoring the "${type}" entrypoint of ${tool.name}: its input schema has required properties`);
          return false;
        }
        return true;
      })
      .map((tool) => ({ server, tool })));
}

interface FileHandler extends Entrypoint {
  /** The tool's one `x-mcp-file` argument. */
  argument: string;
  /** Largest file that this host sends to the server: it only sends files inline. */
  maxBytes: number;
}

/**
 * List the tools that declare a `"file"` entrypoint and that this host can
 * open with a file alone, on servers that advertise the File Uploads extension.
 */
function listFileHandlers(servers: ServerInfo[]): FileHandler[] {
  return servers.flatMap((server) => {
    const extensions = server.client.getServerCapabilities()?.extensions as Record<string, { maxInlineBytes?: unknown }> | undefined;
    const filesExtension = extensions?.[FILES_EXTENSION_ID];
    if (!filesExtension) return [];
    const maxBytes = typeof filesExtension.maxInlineBytes === "number"
      ? filesExtension.maxInlineBytes
      : DEFAULT_MAX_INLINE_BYTES;

    return Array.from(server.tools.values()).flatMap((tool) => {
      if (!getToolEntrypoints(tool).some((entrypoint) => entrypoint.type === "file")) return [];
      const argument = getToolFileArgument(tool);
      if (argument === undefined) {
        log.warn(`Ignoring the "file" entrypoint of ${tool.name}: it needs exactly one x-mcp-file argument, and no other required one`);
        return [];
      }
      return [{ server, tool, argument, maxBytes }];
    });
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Build the `FileInput` of the File Uploads extension for a file, with its bytes inline. */
async function toFileInput(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    id: "file-1",
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: bytes.length,
    // base64url, no padding
    digest: {
      algorithm: "sha-256",
      value: toBase64(hash).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    },
    data: toBase64(bytes),
  };
}

interface EntrypointButtonProps extends Entrypoint {
  disabled?: boolean;
  onClick: () => void;
}
function EntrypointButton({ server, tool, disabled, onClick }: EntrypointButtonProps) {
  return (
    <button title={tool.description} disabled={disabled} onClick={onClick}>
      {getDisplayName(tool)}
      {/* The label is the server's own text: say whose it is */}
      <span className={styles.entrypointServer}>{server.name}</span>
    </button>
  );
}

interface EntrypointsProps {
  serversPromise: Promise<ServerInfo[]>;
  addToolCall: (info: ToolCallInfo) => void;
}

/**
 * Lists the entrypoints of all servers. Renders nothing when no server
 * declares one. Every call here is made on the user's click, never on load.
 */
export function Entrypoints({ serversPromise, addToolCall }: EntrypointsProps) {
  const servers = use(serversPromise);
  const globals = useMemo(() => listEntrypoints(servers, "global"), [servers]);
  const threads = useMemo(() => listEntrypoints(servers, "thread"), [servers]);
  const fileHandlers = useMemo(() => listFileHandlers(servers), [servers]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openedFile, setOpenedFile] = useState<File | null>(null);

  // The entrypoints that match the file that the user picked
  const matches = openedFile
    ? fileHandlers.filter(({ tool }) =>
        getToolEntrypoints(tool).some((entrypoint) =>
          fileMatchesEntrypoint({ name: openedFile.name, mimeType: openedFile.type || undefined }, entrypoint)))
    : [];

  const openFile = async ({ server, tool, argument }: FileHandler, file: File) => {
    setOpenedFile(null);
    const fileInput = await toFileInput(file);
    // The bytes go to the server only: not to the View's tool input, the panel or the console
    const { data: _data, ...shownFileInput } = fileInput;
    addToolCall(callTool(server, tool.name, { [argument]: fileInput }, { [argument]: shownFileInput }));
  };

  return (
    <>
      {globals.length > 0 && (
        <div className={styles.entrypoints}>
          <span title="Global entrypoints: starting points, outside any conversation">Apps</span>
          {globals.map((entrypoint, i) => (
            <EntrypointButton key={i} {...entrypoint} onClick={() => addToolCall(callTool(entrypoint.server, entrypoint.tool.name, {}))} />
          ))}
        </div>
      )}
      {threads.length > 0 && (
        // This page is this host's one conversation, so these open in it like the others
        <div className={styles.entrypoints}>
          <span title="Thread entrypoints: opened inside a conversation, to which they belong">In this conversation</span>
          {threads.map((entrypoint, i) => (
            <EntrypointButton key={i} {...entrypoint} onClick={() => addToolCall(callTool(entrypoint.server, entrypoint.tool.name, {}))} />
          ))}
        </div>
      )}
      {fileHandlers.length > 0 && (
        <div className={styles.entrypoints}>
          <button onClick={() => fileInputRef.current?.click()}>Open file…</button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(e) => {
              setOpenedFile(e.target.files?.[0] ?? null);
              e.target.value = ""; // so that picking the same file again is a change
            }}
          />
          {openedFile && matches.length === 0 && (
            <span className={styles.entrypointNote}>No connected server opens {openedFile.name}</span>
          )}
          {openedFile && matches.length > 0 && (
            <>
              {/* The user chooses the server that receives the file, even when only one matches */}
              <span className={styles.entrypointNote}>Send {openedFile.name} to</span>
              {matches.map((handler, i) => {
                const tooLarge = openedFile.size > handler.maxBytes;
                return (
                  <span key={i} className={styles.entrypointChoice}>
                    <EntrypointButton {...handler} disabled={tooLarge} onClick={() => openFile(handler, openedFile)} />
                    {tooLarge && (
                      <span className={styles.entrypointNote}>
                        too large: {openedFile.size} bytes, and this server takes {handler.maxBytes} inline
                      </span>
                    )}
                  </span>
                );
              })}
              <button onClick={() => setOpenedFile(null)}>Cancel</button>
            </>
          )}
        </div>
      )}
    </>
  );
}
