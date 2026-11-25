/**
 * What the host keeps in its own `localStorage` so that tool calls, and the
 * state their Views saved with `ui/set-view-state`, survive a page reload.
 *
 * A real host would keep both with the conversation, on its backend.
 */
import {
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
} from "@modelcontextprotocol/client";

const TOOL_CALLS_KEY = "basic-host:tool-calls";
const VIEW_STATE_KEY_PREFIX = "basic-host:view-state:";

/** Advertised as `hostCapabilities.viewState.maxBytes`. */
export const VIEW_STATE_MAX_BYTES = 65536;

/** Enough to render a tool call's View again without calling the tool. */
export interface StoredToolCall {
  /** Host-generated; identifies the View instance across reloads. */
  id: string;
  serverUrl: string;
  /** Checked on restore: another server may be at that URL by then. */
  serverName: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Absent until the tool call has finished. */
  result?: CallToolResult;
}

export type ViewState = Record<string, unknown> | null;

/** Returns `[]` if nothing is stored, or if storage is unavailable or corrupt. */
export function loadStoredToolCalls(): StoredToolCall[] {
  try {
    const calls = JSON.parse(localStorage.getItem(TOOL_CALLS_KEY) ?? "[]");
    if (!Array.isArray(calls)) return [];
    return calls.filter((call) => typeof call?.id === "string");
  } catch (error) {
    console.warn("[HOST] Could not read stored tool calls:", error);
    return [];
  }
}

// Best effort: if this fails the host works as before, without persistence.
function updateStoredToolCalls(
  update: (calls: StoredToolCall[]) => StoredToolCall[],
): void {
  try {
    const calls = update(loadStoredToolCalls());
    localStorage.setItem(TOOL_CALLS_KEY, JSON.stringify(calls));
  } catch (error) {
    console.warn("[HOST] Could not store tool calls:", error);
  }
}

export function addStoredToolCall(call: StoredToolCall): void {
  updateStoredToolCalls((calls) => [...calls, call]);
}

/** Does nothing if the call was removed in the meantime. */
export function setStoredToolCallResult(
  id: string,
  result: CallToolResult,
): void {
  updateStoredToolCalls((calls) =>
    calls.map((call) => (call.id === id ? { ...call, result } : call)),
  );
}

/** Removes a tool call and, with it, the state that its View saved. */
export function removeStoredToolCall(serverUrl: string, id: string): void {
  updateStoredToolCalls((calls) => calls.filter((call) => call.id !== id));
  try {
    localStorage.removeItem(viewStateKey(serverUrl, id));
  } catch (error) {
    console.warn("[HOST] Could not delete saved view state:", error);
  }
}

/**
 * The host derives the key under which a View's state is saved; the View can
 * neither name nor influence it. The spec asks for at least the user, the
 * user's connection to the server and the View instance. This host has no
 * user accounts, and identifies a server connection by its configured URL.
 */
function viewStateKey(serverUrl: string, toolCallId: string): string {
  return `${VIEW_STATE_KEY_PREFIX}${toolCallId}:${serverUrl}`;
}

/**
 * Returns the saved state, or `null` if nothing is saved.
 * @throws if storage cannot be read. The host must then not advertise
 *   `hostCapabilities.viewState` for this render.
 */
export function loadViewState(serverUrl: string, toolCallId: string): ViewState {
  const json = localStorage.getItem(viewStateKey(serverUrl, toolCallId));
  return json === null ? null : JSON.parse(json);
}

/**
 * Replaces the saved state as a whole; `null` clears it.
 * @throws if the state is too large (`-32602`: never as given) or cannot be
 *   stored (a plain error, which reaches the View as `-32603`: not now). What
 *   was saved before then stays as it was.
 */
export function saveViewState(
  serverUrl: string,
  toolCallId: string,
  state: ViewState,
): void {
  // A save that arrives after its call was closed must not bring state back.
  if (!loadStoredToolCalls().some((call) => call.id === toolCallId)) {
    throw new Error("Tool call is no longer stored");
  }
  const key = viewStateKey(serverUrl, toolCallId);
  if (state === null) {
    localStorage.removeItem(key);
    return;
  }
  const json = JSON.stringify(state);
  if (new TextEncoder().encode(json).length > VIEW_STATE_MAX_BYTES) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      "View state too large",
    );
  }
  localStorage.setItem(key, json);
}
