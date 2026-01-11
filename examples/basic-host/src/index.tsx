import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Component, type ErrorInfo, type ReactNode, StrictMode, Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { callTool, connectToServer, hasAppHtml, initializeApp, loadSandboxProxy, log, newAppBridge, type ServerInfo, type ToolCallInfo } from "./implementation";
import styles from "./index.module.css";


/**
 * Extract default values from a tool's JSON Schema inputSchema.
 * Returns a formatted JSON string with defaults, or "{}" if none found.
 */
function getToolDefaults(tool: Tool | undefined): string {
  if (!tool?.inputSchema?.properties) return "{}";

  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
    if (prop && typeof prop === "object" && "default" in prop) {
      defaults[key] = prop.default;
    }
  }

  return Object.keys(defaults).length > 0
    ? JSON.stringify(defaults, null, 2)
    : "{}";
}


// Host passes serversPromise to CallToolPanel
interface HostProps {
  serversPromise: Promise<ServerInfo[]>;
}

type ToolCallEntry = ToolCallInfo & { id: number };
let nextToolCallId = 0;

function Host({ serversPromise }: HostProps) {
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const [destroyingIds, setDestroyingIds] = useState<Set<number>>(new Set());

  const requestClose = (id: number) => {
    setDestroyingIds((s) => new Set(s).add(id));
  };

  const completeClose = (id: number) => {
    setDestroyingIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    setToolCalls((calls) => calls.filter((c) => c.id !== id));
  };

  return (
    <>
      {toolCalls.map((info) => (
        <ToolCallInfoPanel
          key={info.id}
          toolCallInfo={info}
          isDestroying={destroyingIds.has(info.id)}
          onRequestClose={() => requestClose(info.id)}
          onCloseComplete={() => completeClose(info.id)}
        />
      ))}
      <CallToolPanel
        serversPromise={serversPromise}
        addToolCall={(info) => setToolCalls([...toolCalls, { ...info, id: nextToolCallId++ }])}
      />
    </>
  );
}


// CallToolPanel renders the unified form with Suspense around ServerSelect
interface CallToolPanelProps {
  serversPromise: Promise<ServerInfo[]>;
  addToolCall: (info: ToolCallInfo) => void;
}
function CallToolPanel({ serversPromise, addToolCall }: CallToolPanelProps) {
  const [selectedServer, setSelectedServer] = useState<ServerInfo | null>(null);
  const [selectedTool, setSelectedTool] = useState("");
  const [inputJson, setInputJson] = useState("{}");

  const toolNames = selectedServer ? Array.from(selectedServer.tools.keys()) : [];

  const isValidJson = useMemo(() => {
    try {
      JSON.parse(inputJson);
      return true;
    } catch {
      return false;
    }
  }, [inputJson]);

  const handleServerSelect = (server: ServerInfo) => {
    setSelectedServer(server);
    const [firstTool] = server.tools.keys();
    setSelectedTool(firstTool ?? "");
    // Set input JSON to tool defaults (if any)
    setInputJson(getToolDefaults(server.tools.get(firstTool ?? "")));
  };

  const handleToolSelect = (toolName: string) => {
    setSelectedTool(toolName);
    // Set input JSON to tool defaults (if any)
    setInputJson(getToolDefaults(selectedServer?.tools.get(toolName)));
  };

  const handleSubmit = () => {
    if (!selectedServer) return;
    const toolCallInfo = callTool(selectedServer, selectedTool, JSON.parse(inputJson));
    addToolCall(toolCallInfo);
  };

  return (
    <div className={styles.callToolPanel}>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <label>
          Server
          <Suspense fallback={<select disabled><option>Loading...</option></select>}>
            <ServerSelect serversPromise={serversPromise} onSelect={handleServerSelect} />
          </Suspense>
        </label>
        <label>
          Tool
          <select
            className={styles.toolSelect}
            value={selectedTool}
            onChange={(e) => handleToolSelect(e.target.value)}
          >
            {selectedServer && toolNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Input
          <textarea
            className={styles.toolInput}
            aria-invalid={!isValidJson}
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!selectedTool || !isValidJson}>
          Call Tool
        </button>
      </form>
    </div>
  );
}


// ServerSelect calls use() and renders the server <select>
interface ServerSelectProps {
  serversPromise: Promise<ServerInfo[]>;
  onSelect: (server: ServerInfo) => void;
}
function ServerSelect({ serversPromise, onSelect }: ServerSelectProps) {
  const servers = use(serversPromise);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (servers.length > selectedIndex) {
      onSelect(servers[selectedIndex]);
    }
  }, [servers]);

  if (servers.length === 0) {
    return <select disabled><option>No servers configured</option></select>;
  }

  return (
    <select
      value={selectedIndex}
      onChange={(e) => {
        const newIndex = Number(e.target.value);
        setSelectedIndex(newIndex);
        onSelect(servers[newIndex]);
      }}
    >
      {servers.map((server, i) => (
        <option key={i} value={i}>{server.name}</option>
      ))}
    </select>
  );
}


interface ToolCallInfoPanelProps {
  toolCallInfo: ToolCallInfo;
  isDestroying?: boolean;
  onRequestClose?: () => void;
  onCloseComplete?: () => void;
}
function ToolCallInfoPanel({ toolCallInfo, isDestroying, onRequestClose, onCloseComplete }: ToolCallInfoPanelProps) {
  const isApp = hasAppHtml(toolCallInfo);

  // For non-app tool calls, close immediately when isDestroying becomes true
  useEffect(() => {
    if (isDestroying && !isApp) {
      onCloseComplete?.();
    }
  }, [isDestroying, isApp, onCloseComplete]);

  return (
    <div
      className={styles.toolCallInfoPanel}
      style={isDestroying ? { opacity: 0.5, pointerEvents: "none" } : undefined}
    >
      <div className={styles.inputInfoPanel}>
        <h2>
          <span>{toolCallInfo.serverInfo.name}</span>
          <span className={styles.toolName}>{toolCallInfo.tool.name}</span>
          {onRequestClose && !isDestroying && (
            <button
              className={styles.closeButton}
              onClick={onRequestClose}
              title="Close"
            >
              ×
            </button>
          )}
        </h2>
        <JsonBlock value={toolCallInfo.input} />
      </div>
      <div className={styles.outputInfoPanel}>
        <ErrorBoundary>
          <Suspense fallback="Loading...">
            {
              isApp
                ? <AppIFramePanel
                    toolCallInfo={toolCallInfo}
                    isDestroying={isDestroying}
                    onTeardownComplete={onCloseComplete}
                  />
                : <ToolResultPanel toolCallInfo={toolCallInfo} />
            }
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}


function JsonBlock({ value }: { value: object }) {
  return (
    <pre className={styles.jsonBlock}>
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}


interface AppIFramePanelProps {
  toolCallInfo: Required<ToolCallInfo>;
  isDestroying?: boolean;
  onTeardownComplete?: () => void;
}
function AppIFramePanel({ toolCallInfo, isDestroying, onTeardownComplete }: AppIFramePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const appBridgeRef = useRef<ReturnType<typeof newAppBridge> | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current!;

    // First get CSP from resource, then load sandbox with CSP in query param
    // This ensures CSP is set via HTTP headers (tamper-proof)
    toolCallInfo.appResourcePromise.then(({ csp }) => {
      loadSandboxProxy(iframe, csp).then((firstTime) => {
        // The `firstTime` check guards against React Strict Mode's double
        // invocation (mount → unmount → remount simulation in development).
        // Outside of Strict Mode, this `useEffect` runs only once per
        // `toolCallInfo`.
        if (firstTime) {
          const appBridge = newAppBridge(toolCallInfo.serverInfo, iframe);
          appBridgeRef.current = appBridge;
          initializeApp(iframe, appBridge, toolCallInfo);
        }
      });
    });
  }, [toolCallInfo]);

  // Graceful teardown: wait for guest to respond before unmounting
  // This follows the spec: "Host SHOULD wait for a response before tearing
  // down the resource (to prevent data loss)."
  useEffect(() => {
    if (!isDestroying) return;

    if (!appBridgeRef.current) {
      // Bridge not ready yet (e.g., user closed before iframe loaded)
      onTeardownComplete?.();
      return;
    }

    log.info("Sending teardown notification to MCP App");
    appBridgeRef.current.teardownResource({})
      .catch((err) => {
        log.warn("Teardown request failed (app may have already closed):", err);
      })
      .finally(() => {
        onTeardownComplete?.();
      });
  }, [isDestroying, onTeardownComplete]);

  return (
    <div className={styles.appIframePanel}>
      <iframe ref={iframeRef} />
    </div>
  );
}


interface ToolResultPanelProps {
  toolCallInfo: ToolCallInfo;
}
function ToolResultPanel({ toolCallInfo }: ToolResultPanelProps) {
  const result = use(toolCallInfo.resultPromise);
  return <JsonBlock value={result} />;
}


interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: undefined };

  // Called during render phase - must be pure (no side effects)
  // Note: error is `unknown` because JS allows throwing any value
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  // Called during commit phase - can have side effects (logging, etc.)
  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    log.error("Caught:", error, errorInfo.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { error } = this.state;
      const message = error instanceof Error ? error.message : String(error);
      return <div className={styles.error}><strong>ERROR:</strong> {message}</div>;
    }
    return this.props.children;
  }
}


async function connectToAllServers(): Promise<ServerInfo[]> {
  const serverUrlsResponse = await fetch("/api/servers");
  const serverUrls = (await serverUrlsResponse.json()) as string[];

  // Use allSettled to be resilient to individual server failures
  const results = await Promise.allSettled(
    serverUrls.map((url) => connectToServer(new URL(url)))
  );

  const servers: ServerInfo[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      servers.push(result.value);
    } else {
      console.warn(`[HOST] Failed to connect to ${serverUrls[i]}:`, result.reason);
    }
  }

  if (servers.length === 0 && serverUrls.length > 0) {
    throw new Error(`Failed to connect to any servers (${serverUrls.length} attempted)`);
  }

  return servers;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Host serversPromise={connectToAllServers()} />
    </ErrorBoundary>
  </StrictMode>,
);
