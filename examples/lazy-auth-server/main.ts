/**
 * Entry point for running the Lazy Auth demo MCP server.
 * Run with: npx mcp-server-lazy-auth
 * Or: node dist/index.js
 *
 * This example is HTTP-only (no stdio mode): the lazy-auth flow it demonstrates
 * relies on HTTP status codes (401 + WWW-Authenticate) and OAuth endpoints.
 *
 * To test with a remote MCP host, expose the server through a public tunnel
 * and set PUBLIC_URL to the tunnel URL so OAuth metadata and callback URLs
 * use it (see docs/testing-mcp-apps.md in the repository root).
 */
import { createApp, PORT } from "./server.js";

async function main() {
  const app = createApp();

  const httpServer = app.listen(PORT, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.log(
      `Lazy Auth demo MCP server listening on http://localhost:${PORT}/mcp`,
    );
    console.log(
      `  Tools: show_auth_button, get_secret [PROTECTED], revoke_auth_token [PROTECTED], elicit_url, elicit_by_error`,
    );
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
