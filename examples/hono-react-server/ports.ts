export function resolveMcpPort(): number {
  return Number.parseInt(
    process.env.PORT ?? process.env.MCP_PORT ?? "3001",
    10,
  );
}

export function resolveBackendPort(): number {
  const portEnv = process.env.PORT;
  const mcpPort = resolveMcpPort();
  const backendPort =
    process.env.BACKEND_PORT ?? (portEnv ? String(mcpPort + 1000) : "3102");
  return Number.parseInt(backendPort, 10);
}

export function resolveBackendUrl(): string {
  return `http://localhost:${resolveBackendPort()}`;
}
