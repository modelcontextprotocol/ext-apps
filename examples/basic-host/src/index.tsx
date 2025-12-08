import { Component, type ErrorInfo, type ReactNode, StrictMode, Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { callTool, connectToServer, hasAppHtml, initializeApp, loadSandboxProxy, log, newAppBridge, type ServerInfo, type ToolCallInfo } from "./implementation";
import styles from "./index.module.css";


// Available MCP servers - using ports 3101+ to avoid conflicts with common dev ports
const SERVERS = [
  { name: "Basic React", port: 3101 },
  { name: "Vanilla JS", port: 3102 },
  { name: "Budget Allocator", port: 3103 },
  { name: "Cohort Heatmap", port: 3104 },
  { name: "Customer Segmentation", port: 3105 },
  { name: "Scenario Modeler", port: 3106 },
  { name: "System Monitor", port: 3107 },
] as const;

function serverUrl(port: number): string {
  return `http://localhost:${port}/mcp`;
}


interface HostProps {
  serverInfoPromise: Promise<ServerInfo>;
}
function Host({ serverInfoPromise }: HostProps) {
  const serverInfo = use(serverInfoPromise);
  const [toolCallInfos, setToolCallInfos] = useState<ToolCallInfo[]>([]);

  return (
    <>
      {toolCallInfos.map((info, i) => (
        <ToolCallInfoPanel key={i} toolCallInfo={info} />
      ))}
      <CallToolPanel
        serverInfo={serverInfo}
        addToolCallInfo={(info) => setToolCallInfos([...toolCallInfos, info])}
      />
    </>
  );
}


interface CallToolPanelProps {
  serverInfo: ServerInfo;
  addToolCallInfo: (toolCallInfo: ToolCallInfo) => void;
}
function CallToolPanel({ serverInfo, addToolCallInfo }: CallToolPanelProps) {
  const toolNames = Array.from(serverInfo.tools.keys());
  const [selectedTool, setSelectedTool] = useState(toolNames[0] ?? "");
  const [inputJson, setInputJson] = useState("{}");

  const isValidJson = useMemo(() => {
    try {
      JSON.parse(inputJson);
      return true;
    } catch {
      return false;
    }
  }, [inputJson]);

  const handleSubmit = () => {
    const toolCallInfo = callTool(serverInfo, selectedTool, JSON.parse(inputJson));
    addToolCallInfo(toolCallInfo);
  };

  return (
    <div className={styles.callToolPanel}>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <label>
          Tool Name
          <select
            value={selectedTool}
            onChange={(e) => setSelectedTool(e.target.value)}
          >
            {toolNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Tool Input
          <textarea
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


interface ToolCallInfoPanelProps {
  toolCallInfo: ToolCallInfo;
}
function ToolCallInfoPanel({ toolCallInfo }: ToolCallInfoPanelProps) {
  return (
    <div className={styles.toolCallInfoPanel}>
      <div className={styles.inputInfoPanel}>
        <h2 className={styles.toolName}>{toolCallInfo.tool.name}</h2>
        <JsonBlock value={toolCallInfo.input} />
      </div>
      <div className={styles.outputInfoPanel}>
        <ErrorBoundary>
          <Suspense fallback="Loading...">
            {
              hasAppHtml(toolCallInfo)
                ? <AppIFramePanel toolCallInfo={toolCallInfo} />
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
}
function AppIFramePanel({ toolCallInfo }: AppIFramePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current!;
    loadSandboxProxy(iframe).then((firstTime) => {
      // The `firstTime` check guards against React Strict Mode's double
      // invocation (mount → unmount → remount simulation in development).
      // Outside of Strict Mode, this `useEffect` runs only once per
      // `toolCallInfo`.
      if (firstTime) {
        const appBridge = newAppBridge(toolCallInfo.serverInfo, iframe);
        initializeApp(iframe, appBridge, toolCallInfo);
      }
    });
  }, [toolCallInfo]);

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


interface ServerSelectorProps {
  selectedPort: number;
  onSelect: (port: number) => void;
}
function ServerSelector({ selectedPort, onSelect }: ServerSelectorProps) {
  return (
    <div className={styles.serverSelector}>
      <label>
        Server
        <select
          value={selectedPort}
          onChange={(e) => onSelect(Number(e.target.value))}
        >
          {SERVERS.map(({ name, port }) => (
            <option key={port} value={port}>
              {name} (:{port})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}


function App() {
  const [selectedPort, setSelectedPort] = useState(SERVERS[0].port);
  const [serverInfoPromise, setServerInfoPromise] = useState(
    () => connectToServer(new URL(serverUrl(selectedPort)))
  );

  const handleServerChange = (port: number) => {
    setSelectedPort(port);
    setServerInfoPromise(connectToServer(new URL(serverUrl(port))));
  };

  return (
    <>
      <ServerSelector selectedPort={selectedPort} onSelect={handleServerChange} />
      <Suspense fallback={<p className={styles.connecting}>Connecting to {serverUrl(selectedPort)}...</p>}>
        <Host key={selectedPort} serverInfoPromise={serverInfoPromise} />
      </Suspense>
    </>
  );
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
