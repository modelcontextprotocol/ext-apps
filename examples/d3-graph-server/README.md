# Example: D3 Graph Server

Interactive force-directed graph visualization using D3.js. Explore entity relationships like package dependencies, org charts, or knowledge graphs with zoom, pan, and node interaction.

## Features

- **Force-directed layout**: Physics-based graph simulation with D3.js
- **Multiple graph datasets**: Package dependencies, org chart, and AI/ML knowledge graph
- **Interactive nodes**: Drag to reposition, click to recenter view
- **Zoom and pan**: Scroll to zoom, drag background to pan
- **Tooltips**: Hover over nodes to see descriptions
- **Node filtering**: Center on any node with configurable depth

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

### Tool Input Examples

**Default (package dependencies graph):**

```json
{}
```

**Package dependencies - centered on React:**

```json
{
  "graphId": "dependencies",
  "centerNode": "react",
  "depth": 2
}
```

**Package dependencies - centered on D3:**

```json
{
  "graphId": "dependencies",
  "centerNode": "d3",
  "depth": 3
}
```

**Organization chart:**

```json
{
  "graphId": "org-chart"
}
```

**Org chart - centered on VP of Engineering:**

```json
{
  "graphId": "org-chart",
  "centerNode": "vp-eng",
  "depth": 2
}
```

**AI/ML knowledge graph:**

```json
{
  "graphId": "knowledge"
}
```

**Knowledge graph - centered on transformers:**

```json
{
  "graphId": "knowledge",
  "centerNode": "transformers",
  "depth": 2
}
```

**Knowledge graph - centered on PyTorch:**

```json
{
  "graphId": "knowledge",
  "centerNode": "pytorch",
  "depth": 3
}
```

## Architecture

### Server (`server.ts`)

MCP server with sample graph datasets representing different relationship types.

Exposes one tool:

- `get-graph-data` - Returns nodes and links for force-directed visualization

### App (`src/mcp-app.ts`)

Vanilla TypeScript app using D3.js that:

- Receives graph data via the MCP App SDK
- Renders an interactive force-directed graph with `d3.forceSimulation()`
- Supports zoom/pan via `d3.zoom()`
- Enables node dragging and click-to-recenter
