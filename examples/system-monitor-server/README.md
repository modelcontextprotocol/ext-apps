# Example: System Monitor App

A demo MCP App that displays real-time OS metrics with a stacked area chart for per-core CPU usage and a bar gauge for memory.

<table>
  <tr>
    <td><a href="https://modelcontextprotocol.github.io/ext-apps/screenshots/system-monitor-server/01-initial-state.png"><img src="https://modelcontextprotocol.github.io/ext-apps/screenshots/system-monitor-server/01-initial-state.png" alt="Initial state" width="100%"></a></td>
    <td><a href="https://modelcontextprotocol.github.io/ext-apps/screenshots/system-monitor-server/02-cpu-data-accumulated.png"><img src="https://modelcontextprotocol.github.io/ext-apps/screenshots/system-monitor-server/02-cpu-data-accumulated.png" alt="CPU data accumulated" width="100%"></a></td>
    <td><a href="https://modelcontextprotocol.github.io/ext-apps/screenshots/system-monitor-server/03-extended-cpu-history.png"><img src="https://modelcontextprotocol.github.io/ext-apps/screenshots/system-monitor-server/03-extended-cpu-history.png" alt="Extended CPU history" width="100%"></a></td>
  </tr>
</table>

## MCP Client Configuration

Add to your MCP client configuration (stdio transport):

```json
{
  "mcpServers": {
    "system-monitor": {
      "command": "npx",
      "args": [
        "-y",
        "--silent",
        "--registry=https://registry.npmjs.org/",
        "@modelcontextprotocol/server-system-monitor",
        "--stdio"
      ]
    }
  }
}
```

### Local Development

To test local modifications, use this configuration (replace `~/code/ext-apps` with your clone path):

```json
{
  "mcpServers": {
    "system-monitor": {
      "command": "bash",
      "args": [
        "-c",
        "cd ~/code/ext-apps/examples/system-monitor-server && npm run build >&2 && node dist/index.js --stdio"
      ]
    }
  }
}
```

## Features

- **Per-Core CPU Monitoring**: Stacked area chart showing individual CPU core utilization over a 1-minute sliding window
- **Memory Usage**: Horizontal bar gauge with color-coded thresholds (green/yellow/red)
- **System Info**: Hostname, platform, and uptime display
- **Auto-Polling**: Automatically starts monitoring on load with 2-second refresh interval
- **Theme Support**: Adapts to light/dark mode preferences

## Running

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build and start the server:

   ```bash
   npm run start:http  # for Streamable HTTP transport
   # OR
   npm run start:stdio  # for stdio transport
   ```

3. View using the [`basic-host`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) example or another MCP Apps-compatible host.

## Architecture

### Server (`server.ts`)

Exposes two tools demonstrating a polling pattern:

1. **`get-system-info`** (Model-visible) — Returns static system configuration:
   - Hostname, platform, architecture
   - CPU model and core count
   - Total memory

2. **`poll-system-stats`** (App-only, `visibility: ["app"]`) — Returns dynamic metrics:
   - Per-core CPU timing data (idle/total counters)
   - Memory usage (used/free/percentage)
   - Uptime

The Model-visible tool is linked to a UI resource via `_meta.ui.resourceUri`.

### App (`src/mcp-app.ts`)

- Receives static system info via `ontoolresult` when the host sends the `get-system-info` result
- Polls `poll-system-stats` every 2 seconds for dynamic metrics
- Uses Chart.js for the stacked area chart visualization
- Computes CPU usage percentages client-side from timing deltas
- Maintains a 30-point history (1 minute at 2s intervals)
