# Example: Interactive Map

![Screenshot](screenshot.png)

Interactive 3D globe viewer using CesiumJS with multiple tile provider options. Demonstrates geocoding integration and full MCP App capabilities.

## MCP Client Configuration

Add to your MCP client configuration (stdio transport):

```json
{
  "mcpServers": {
    "map": {
      "command": "npx",
      "args": [
        "-y",
        "--silent",
        "--registry=https://registry.npmjs.org/",
        "@modelcontextprotocol/server-map",
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
    "map": {
      "command": "bash",
      "args": [
        "-c",
        "cd ~/code/ext-apps/examples/map-server && npm run build >&2 && node dist/index.js --stdio"
      ]
    }
  }
}
```

## Features

- **3D Globe Rendering**: Interactive CesiumJS globe with rotation, zoom, and 3D perspective
- **Geocoding**: Search for places using OpenStreetMap Nominatim (no API key required)
- **Multiple Tile Styles**: Choose between Carto Voyager (smooth, with retina support) or classic OpenStreetMap tiles
- **Retina Support**: Automatic @2x tile loading on high-DPI displays for sharper rendering
- **Dynamic Loading**: CesiumJS loaded from CDN at runtime for smaller bundle size

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

## Tools

### `geocode`

Search for places by name or address. Returns coordinates and bounding boxes.

```json
{
  "query": "Eiffel Tower"
}
```

Returns up to 5 matches with lat/lon coordinates and bounding boxes.

### `show-map`

Display the 3D globe zoomed to a bounding box.

```json
{
  "west": 2.29,
  "south": 48.85,
  "east": 2.3,
  "north": 48.86,
  "label": "Eiffel Tower",
  "style": "carto"
}
```

Parameters:
- `west`, `south`, `east`, `north`: Bounding box coordinates (defaults to London)
- `label`: Optional label to display
- `style`: Tile style - `"carto"` (default, smooth with retina) or `"osm"` (classic, more detailed)

## Architecture

### Server (`server.ts`)

Exposes two tools:

- `geocode` - Queries OpenStreetMap Nominatim API with rate limiting
- `show-map` - Renders the CesiumJS globe UI at a specified location with configurable tile style

Configures Content Security Policy to allow fetching tiles from Carto, OSM, and Cesium CDN.

### App (`src/mcp-app.ts`)

Vanilla TypeScript app that:

- Dynamically loads CesiumJS from CDN
- Supports multiple tile providers (Carto Voyager with @2x retina, classic OSM)
- Receives tool inputs via the MCP App SDK
- Handles camera navigation to specified bounding boxes
- Switches tile styles at runtime based on tool input

## Key Files

- [`server.ts`](server.ts) - MCP server with geocode and show-map tools
- [`mcp-app.html`](mcp-app.html) / [`src/mcp-app.ts`](src/mcp-app.ts) - CesiumJS globe UI
- [`server-utils.ts`](server-utils.ts) - HTTP server utilities

## Notes

- Rate limiting is applied to Nominatim requests (1 request per second per their usage policy)
- The globe works in sandboxed iframes with appropriate CSP configuration
- No external API keys required - uses only open data sources
