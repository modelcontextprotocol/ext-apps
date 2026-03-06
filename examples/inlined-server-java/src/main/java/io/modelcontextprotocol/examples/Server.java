package io.modelcontextprotocol.examples;

import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpServerFeatures;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import io.modelcontextprotocol.spec.McpServerTransportProvider;
import io.modelcontextprotocol.spec.McpStatelessServerTransport;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * MCP server definition: registers a "get-time" tool with an inline HTML UI resource.
 */
public class Server {

    static final String RESOURCE_URI = "ui://get-time/index.html";
    static final String RESOURCE_MIME = "text/html;profile=mcp-app";

    static final String UI_HTML = """
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="color-scheme" content="light dark">
              <title>Get Time</title>
            </head>
            <body>
              <p><strong>Server time:</strong> <code id="time">—</code></p>
              <script type="module">
                import { App } from 'https://unpkg.com/@modelcontextprotocol/ext-apps@1.0.1/dist/src/app-with-deps.js';
                const app = new App({ name: 'get-time-app', version: '1.0.0' });
                app.ontoolresult = (result) => {
                  document.getElementById('time').textContent =
                    result.structuredContent?.time ?? result.content?.[0]?.text ?? '?';
                };
                await app.connect();
              </script>
            </body>
            </html>
            """;

    static final McpSchema.Tool TOOL = McpSchema.Tool.builder()
            .name("get-time")
            .description("Returns the current server time as an ISO 8601 string")
            .inputSchema(new McpSchema.JsonSchema("object", null, null, null, null, null))
            .meta(Map.of("ui", Map.of("resourceUri", RESOURCE_URI)))
            .build();

    static final McpSchema.Resource RESOURCE = McpSchema.Resource.builder()
            .uri(RESOURCE_URI).name("Get Time UI").mimeType(RESOURCE_MIME).build();

    static McpSchema.CallToolResult getTime() {
        var time = Instant.now().toString();
        return McpSchema.CallToolResult.builder()
                .content(List.of(new McpSchema.TextContent(time)))
                .structuredContent(Map.of("time", time))
                .build();
    }

    static McpSchema.ReadResourceResult readResource() {
        return new McpSchema.ReadResourceResult(List.of(new McpSchema.TextResourceContents(
                RESOURCE_URI, RESOURCE_MIME, UI_HTML,
                Map.of("ui", Map.of("csp", Map.of("resourceDomains", List.of("https://unpkg.com")))))));
    }

    /** Stateful server (stdio). */
    static void create(McpServerTransportProvider transport) {
        McpServer.sync(transport)
                .serverInfo("inlined-server-java", "1.0.0")
                .tools(new McpServerFeatures.SyncToolSpecification(TOOL, (ex, a) -> getTime()))
                .resources(new McpServerFeatures.SyncResourceSpecification(RESOURCE, (ex, r) -> readResource()))
                .build();
    }

    /** Stateless server (HTTP, matches JS examples). */
    static void create(McpStatelessServerTransport transport) {
        McpServer.sync(transport)
                .serverInfo("inlined-server-java", "1.0.0")
                .tools(new McpStatelessServerFeatures.SyncToolSpecification(TOOL, (ctx, r) -> getTime()))
                .resources(new McpStatelessServerFeatures.SyncResourceSpecification(RESOURCE, (ctx, r) -> readResource()))
                .build();
    }
}
