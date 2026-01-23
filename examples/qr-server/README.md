# QR Code MCP Server

A minimal Python MCP server that generates customizable QR codes with an interactive view UI.

![Screenshot](https://modelcontextprotocol.github.io/ext-apps/screenshots/qr-server/screenshot.png)

## MCP Client Configuration

First, clone the repository:

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
```

Then add to your MCP client configuration (stdio transport), replacing the path with your clone location:

```json
{
  "mcpServers": {
    "qr": {
      "command": "uv",
      "args": [
        "run",
        "/path/to/ext-apps/examples/qr-server/server.py",
        "--stdio"
      ]
    }
  }
}
```

## Features

- Generate QR codes from any text or URL
- Customizable colors, size, and error correction
- Interactive view that displays in MCP-UI enabled clients
- Supports both HTTP (for web clients) and stdio (for MCP clients)

## Prerequisites

This server uses [uv](https://docs.astral.sh/uv/) for dependency management. Install it first:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Quick Start

```bash
# Run server (HTTP mode) - uv handles dependencies automatically
uv run server.py
# → QR Code Server listening on http://localhost:3108/mcp
```

## Usage

### HTTP Mode (for basic-host / web clients)

```bash
uv run server.py
```

Connect from basic-host:

```bash
SERVERS='["http://localhost:3108/mcp"]' bun serve.ts
```

### Stdio Mode (for MCP clients)

```bash
uv run server.py --stdio
```

See [MCP Client Configuration](#mcp-client-configuration) above for how to add this server to your MCP client.

### Docker (accessing host server from container)

```
http://host.docker.internal:3108/mcp
```

## Tool: `generate_qr`

Generate a QR code with optional customization.

### Parameters

| Parameter          | Type   | Default    | Description                     |
| ------------------ | ------ | ---------- | ------------------------------- |
| `text`             | string | (required) | The text or URL to encode       |
| `box_size`         | int    | 10         | Size of each box in pixels      |
| `border`           | int    | 4          | Border size in boxes            |
| `error_correction` | string | "M"        | Error correction level: L/M/Q/H |
| `fill_color`       | string | "black"    | Foreground color (hex or name)  |
| `back_color`       | string | "white"    | Background color (hex or name)  |

### Error Correction Levels

| Level | Recovery | Use Case                  |
| ----- | -------- | ------------------------- |
| L     | 7%       | Clean environments        |
| M     | 15%      | General use (default)     |
| Q     | 25%      | Industrial/outdoor        |
| H     | 30%      | Adding logos/damage-prone |

### Example Inputs

**Basic:**

```json
{ "text": "https://example.com" }
```

**Styled:**

```json
{
  "text": "https://claude.ai",
  "fill_color": "#CC785C",
  "back_color": "#FFF8F5",
  "box_size": 12,
  "border": 3
}
```

**Dark Mode:**

```json
{
  "text": "Hello World",
  "fill_color": "#E0E0E0",
  "back_color": "#1a1a1a",
  "box_size": 15,
  "border": 2
}
```

**WiFi QR Code:**

```json
{
  "text": "WIFI:T:WPA;S:MyNetwork;P:MyPassword;;",
  "error_correction": "H",
  "box_size": 10
}
```

## Architecture

```
qr-server/
├── server.py      # MCP server (FastMCP + uvicorn, deps inline via PEP 723)
├── view.html    # Interactive UI view
└── README.md
```

### Protocol

The view uses MCP Apps SDK protocol:

1. The view sends `ui/initialize` request
2. Host responds with capabilities
3. The view sends `ui/notifications/initialized`
4. Host sends `ui/notifications/tool-result` with QR image
5. The view renders image and sends `ui/notifications/size-changed`

## Dependencies

Dependencies are declared inline in `server.py` using [PEP 723](https://peps.python.org/pep-0723/) and managed by [uv](https://docs.astral.sh/uv/):

- `mcp` - MCP Python SDK with FastMCP
- `qrcode[pil]` - QR code generation with Pillow
- `uvicorn` - ASGI server
- `starlette` - CORS middleware

## License

MIT
