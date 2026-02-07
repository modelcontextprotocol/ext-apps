# Example: Basic Server (Java WebFlux)

A minimal Java MCP server that performs math operations with an interactive calculator UI. Demonstrates the MCP Java SDK with Spring Boot WebFlux and Streamable HTTP transport.

## MCP Client Configuration

This server uses HTTP transport only (no stdio). Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "calculator": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### Local Development

To test local modifications, first clone the repository and start the server:

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps/examples/basic-server-java-webflux
./mvnw spring-boot:run
```

Then configure your MCP client to connect to `http://localhost:3001/mcp`.

## Features

- Four basic operations: add, subtract, multiply, divide
- Interactive calculator view using ext-apps SDK
- Division by zero error handling
- Structured content metadata for UI integration
- Dark mode support
- Three MCP prompts for guided interactions

## Prerequisites

- Java 17+ (`java -version`)
- No global Maven needed (Maven wrapper included)

## Running

1. Start the server:

   ```bash
   ./mvnw spring-boot:run
   # → Calculator listening on http://localhost:3001/mcp
   ```

2. View using the [`basic-host`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) example or another MCP Apps-compatible host.

### Custom Port

```bash
PORT=3120 ./mvnw spring-boot:run
```

### Docker (accessing host server from container)

```
http://host.docker.internal:3001/mcp
```

## Tool: `calculate`

Perform a math operation on two numbers. Supports add, subtract, multiply, and divide.

### Parameters

| Parameter   | Type   | Default    | Description                                             |
| ----------- | ------ | ---------- | ------------------------------------------------------- |
| `operation` | string | (required) | Math operation: `add`, `subtract`, `multiply`, `divide` |
| `a`         | number | (required) | First operand                                           |
| `b`         | number | (required) | Second operand                                          |

### Example Inputs

**Basic addition:**

```json
{ "operation": "add", "a": 5, "b": 3 }
```

**Decimal multiplication:**

```json
{ "operation": "multiply", "a": 3.14, "b": 2 }
```

**Division by zero (returns error):**

```json
{ "operation": "divide", "a": 10, "b": 0 }
```

## Prompts

| Prompt            | Description                                   | Arguments    |
| ----------------- | --------------------------------------------- | ------------ |
| `quick-calc`      | Evaluate a math expression step by step       | `expression` |
| `compare-numbers` | Compare two numbers using all four operations | `a`, `b`     |
| `percentage`      | Calculate percentages                         | `question`   |

## Architecture

### Server

Four Spring components wired via `McpConfig`:

- **`McpConfig`** - Configures `WebFluxStreamableServerTransportProvider`, `RouterFunction`, and `McpSyncServer` with tools, resources, and prompts
- **`CalculatorTools`** - Tool definition with UI metadata and calculation handler
- **`CalculatorResources`** - Serves the interactive HTML view as an MCP resource with CSP metadata
- **`CalculatorPrompts`** - Three guided prompts for common calculation patterns

### App (`view.html`)

Vanilla JavaScript UI that:

- Loads the MCP Apps SDK from CDN (`@modelcontextprotocol/ext-apps`)
- Provides number inputs and operation buttons
- Calls `app.callServerTool()` on button click
- Displays results from `ontoolresult` callback and `structuredContent` metadata
- Adapts to dark mode via `prefers-color-scheme`

### Key Files

- [`src/main/java/.../McpConfig.java`](src/main/java/com/example/calculator/McpConfig.java) - Spring configuration with WebFlux transport
- [`src/main/java/.../CalculatorTools.java`](src/main/java/com/example/calculator/CalculatorTools.java) - Tool definition and handler
- [`src/main/java/.../CalculatorResources.java`](src/main/java/com/example/calculator/CalculatorResources.java) - HTML resource with CSP
- [`src/main/java/.../CalculatorPrompts.java`](src/main/java/com/example/calculator/CalculatorPrompts.java) - MCP prompts
- [`src/main/resources/view.html`](src/main/resources/view.html) - Interactive calculator UI

## Dependencies

- **Spring Boot 3.5** - WebFlux reactive web framework
- **MCP Java SDK 0.17.2** (`io.modelcontextprotocol.sdk:mcp-spring-webflux`) - Streamable HTTP transport
- **ext-apps SDK** (CDN) - Client-side MCP Apps protocol in `view.html`

## Notes

- This example uses HTTP transport only (Streamable HTTP via WebFlux). Stdio transport is not supported.
- The server uses Netty (via WebFlux) instead of Tomcat for non-blocking request handling.
- CSP metadata is declared on content items in `resources/read` to allow loading the ext-apps SDK from `unpkg.com`.

## License

MIT
