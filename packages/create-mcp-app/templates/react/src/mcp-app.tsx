import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function McpApp() {
  const [message, setMessage] = useState("Connecting...");

  const { app, error } = useApp({
    appInfo: { name: "MCP App", version: "1.0.0" },
    capabilities: {},
  });

  useEffect(() => {
    if (app) setMessage("Connected");
  }, [app]);

  if (error) return <div>Error: {error.message}</div>;

  return (
    <main style={{ padding: "1rem" }}>
      <p>{message}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <McpApp />
  </StrictMode>,
);
