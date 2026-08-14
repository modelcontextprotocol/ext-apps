# Example: Stitch Design Server

An MCP App server that integrates with [Google Stitch](https://stitch.google.com) for AI-powered UI design. Provides 6 tools for managing projects, browsing screens, generating new designs, and extracting design tokens — all rendered in an interactive React UI.

## Tools

| Tool | Description |
| --- | --- |
| `list-projects` | List all Stitch design projects |
| `list-screens` | List screens within a project |
| `design-viewer` | View a screen with image preview, code, and design tokens |
| `generate-design` | Generate a new screen from a text prompt |
| `extract-design-context` | Extract colors, fonts, spacing, and layout tokens |
| `create-project` | Create a new Stitch project |

## Prerequisites

- A Google Cloud project with the Stitch API enabled
- Application Default Credentials (ADC) configured:
  ```bash
  gcloud auth application-default login
  ```
- Set `GOOGLE_CLOUD_PROJECT` environment variable to your GCP project ID

## MCP Client Configuration

```json
{
  "mcpServers": {
    "stitch-design": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-stitch", "--stdio"]
    }
  }
}
```

## Local Development

```bash
npm install
npm run build
npm start          # HTTP mode on port 3001
npm start -- --stdio  # stdio mode
```

## Running Tests

```bash
bun test server.test.ts
```
