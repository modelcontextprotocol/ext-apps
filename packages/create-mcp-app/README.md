# @modelcontextprotocol/create-mcp-app

Scaffold new MCP App projects with one command.

## Usage

```bash
# Interactive mode
npm create @modelcontextprotocol/mcp-app

# With project name
npm create @modelcontextprotocol/mcp-app my-app

# With framework
npm create @modelcontextprotocol/mcp-app my-app --framework react
```

## Frameworks

- **react** - React + Vite + TypeScript
- **vanillajs** - Vanilla JavaScript + Vite + TypeScript

## What's Included

Each generated project includes:

- MCP server with a sample tool
- Interactive UI that communicates with the host
- Vite build configuration for bundling the UI
- TypeScript configuration
- Development server with hot reload

## Getting Started

After creating your project:

```bash
cd my-app
npm run dev
```

## License

MIT
