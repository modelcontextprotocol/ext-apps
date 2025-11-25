import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AppRenderer, AppRendererProps } from "../src/AppRenderer";
import { AppBridge } from "../../../dist/src/app-bridge";

const SANDBOX_PROXY_URL = new URL("http://localhost:8081/sandbox.html");

/**
 * Example React application demonstrating the AppRenderer component.
 *
 * This shows how to:
 * - Connect to an MCP server
 * - List available tools
 * - Render tool UIs using AppRenderer
 * - Handle UI actions from the tool
 */
function ExampleApp() {
  const [client, setClient] = useState<Client | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [activeTools, setActiveTools] = useState<
    Array<{ id: string; name: string; input: Record<string, unknown> }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  // Connect to MCP server on mount
  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const newClient = new Client({
          name: "MCP UI React Host",
          version: "1.0.0",
        });

        const mcpServerUrl = new URL("http://localhost:3001/mcp");
        console.log(
          "[React Host] Attempting SSE connection to",
          mcpServerUrl.href,
        );

        try {
          await newClient.connect(new SSEClientTransport(mcpServerUrl));
          console.log("[React Host] SSE connection successful");
        } catch (err) {
          console.warn(
            "[React Host] SSE connection failed, falling back to HTTP:",
            err,
          );
          await newClient.connect(
            new StreamableHTTPClientTransport(mcpServerUrl),
          );
          console.log("[React Host] HTTP connection successful");
        }

        if (!mounted) return;

        // List available tools
        const toolsResult = await newClient.listTools();

        if (!mounted) return;

        setClient(newClient);
        setTools(toolsResult.tools);
      } catch (err) {
        if (!mounted) return;
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(`Failed to connect to MCP server: ${errorMsg}`);
        console.error("[React Host] Connection error:", err);
      }
    }

    connect();

    return () => {
      mounted = false;
    };
  }, []);

  const handleAddToolUI = (
    toolName: string,
    input: Record<string, unknown>,
  ) => {
    const id = `${toolName}-${Date.now()}`;
    setActiveTools((prev) => [...prev, { id, name: toolName, input }]);
  };

  const handleRemoveToolUI = (id: string) => {
    setActiveTools((prev) => prev.filter((t) => t.id !== id));
  };

  const handleMessage: AppRendererProps["onmessage"] = async (
    params,
    _extra,
  ) => {
    console.log("[React Host] Message:", params);
    return {};
  };

  const handleLoggingMessage: AppRendererProps["onloggingmessage"] = (
    params,
  ) => {
    console.log("[React Host] Logging message:", params);
  };

  const handleOpenLink: AppRendererProps["onopenlink"] = async (
    params,
    _extra,
  ) => {
    console.log("[React Host] Open link request:", params);
    window.open(params.url, "_blank", "noopener,noreferrer");
    return { isError: false };
  };

  const handleError = (toolId: string, err: Error) => {
    console.error(`[React Host] Error from tool ${toolId}:`, err);
    setError(`Tool ${toolId}: ${err.message}`);
  };

  if (error) {
    return (
      <div style={{ padding: "20px" }}>
        <h1>Example MCP-UI React Host</h1>
        <div
          style={{
            color: "red",
            padding: "10px",
            border: "1px solid red",
            borderRadius: "4px",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  if (!client) {
    return (
      <div style={{ padding: "20px" }}>
        <h1>Example MCP-UI React Host</h1>
        <p>Connecting to MCP server...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Example MCP-UI React Host</h1>

      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          backgroundColor: "#f5f5f5",
          borderRadius: "4px",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Available Tools</h2>
        {tools.length === 0 ? (
          <p>No tools available with UI resources.</p>
        ) : (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {tools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => {
                  // Example input - in a real app, you'd have a form for this
                  const input = tool.name.startsWith("pizza-")
                    ? { pizzaTopping: "Mushrooms" }
                    : { message: "Hello from React!" };
                  handleAddToolUI(tool.name, input);
                }}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#007bff",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Add {tool.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {activeTools.map((tool) => (
          <div
            key={tool.id}
            style={{
              padding: "10px",
              border: "2px solid #ddd",
              borderRadius: "8px",
              position: "relative",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "10px",
              }}
            >
              <h3 style={{ margin: 0 }}>{tool.name}</h3>
              <button
                onClick={() => handleRemoveToolUI(tool.id)}
                style={{
                  padding: "4px 12px",
                  backgroundColor: "#dc3545",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </div>

            <AppRenderer
              sandboxProxyUrl={SANDBOX_PROXY_URL}
              client={client}
              toolName={tool.name}
              toolInput={tool.input}
              onmessage={handleMessage}
              onloggingmessage={handleLoggingMessage}
              onopenlink={handleOpenLink}
              onerror={(err) => handleError(tool.id, err)}
            />
          </div>
        ))}

        {activeTools.length === 0 && (
          <p style={{ color: "#666", textAlign: "center", padding: "40px" }}>
            No tool UIs active. Click a button above to add one.
          </p>
        )}
      </div>
    </div>
  );
}

// Mount the React app
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<ExampleApp />);
} else {
  console.error("Root element not found");
}
