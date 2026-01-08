# Example: Recharts Dashboard Server

A React-based business metrics dashboard with switchable chart types. Visualize revenue, sales, and product data with bar, line, area, and pie charts.

## Features

- **Multiple chart types**: Bar, line, area, and pie charts
- **Dataset switching**: Toggle between monthly revenue, quarterly sales, and product mix
- **Responsive design**: Charts adapt to container size
- **Custom tooltips**: Formatted values with dark theme styling
- **Color-coded series**: Each data series has a distinct color
- **Theme support**: Adapts to light/dark mode preferences

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

**Default (monthly revenue as bar chart):**

```json
{}
```

**Monthly revenue as line chart:**

```json
{
  "datasetId": "monthly-revenue",
  "chartType": "line"
}
```

**Monthly revenue as area chart:**

```json
{
  "datasetId": "monthly-revenue",
  "chartType": "area"
}
```

**Quarterly sales by region (bar chart):**

```json
{
  "datasetId": "quarterly-sales"
}
```

**Quarterly sales as line chart:**

```json
{
  "datasetId": "quarterly-sales",
  "chartType": "line"
}
```

**Quarterly sales as area chart:**

```json
{
  "datasetId": "quarterly-sales",
  "chartType": "area"
}
```

**Product mix as pie chart:**

```json
{
  "datasetId": "product-mix"
}
```

**Product mix as bar chart:**

```json
{
  "datasetId": "product-mix",
  "chartType": "bar"
}
```

## Architecture

### Server (`server.ts`)

MCP server with sample business datasets for different visualization scenarios.

Exposes one tool:

- `get-chart-data` - Returns chart data with metadata for rendering

### App (`src/`)

- Built with React for reactive state management
- Uses Recharts for chart visualization
- Components: `ChartRenderer` (renders bar/line/area/pie based on type)
- Chart type and dataset selection triggers tool calls for new data
