# Transcript Server

![Screenshot](screenshot.png)

An MCP App Server for live speech transcription using the Web Speech API.

## MCP Client Configuration

Add to your MCP client configuration (stdio transport):

```json
{
  "mcpServers": {
    "transcript": {
      "command": "npx",
      "args": [
        "-y",
        "--silent",
        "--registry=https://registry.npmjs.org/",
        "@modelcontextprotocol/server-transcript",
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
    "transcript": {
      "command": "bash",
      "args": [
        "-c",
        "cd ~/code/ext-apps/examples/transcript-server && npm run build >&2 && node dist/index.js --stdio"
      ]
    }
  }
}
```

## Features

- **Live Transcription**: Real-time speech-to-text using browser's Web Speech API
- **Transitional Model Context**: Streams interim transcriptions to the model via `ui/update-model-context`, allowing the model to see what the user is saying as they speak
- **Audio Level Indicator**: Visual feedback showing microphone input levels
- **Send to Host**: Button to send completed transcriptions as a `ui/message` to the MCP host
- **Start/Stop Control**: Toggle listening on and off
- **Clear Transcript**: Reset the transcript area

## Setup

### Prerequisites

- Node.js 18+
- Chrome, Edge, or Safari (Web Speech API support)

### Installation

```bash
npm install
```

### Running

```bash
# Development mode (with hot reload)
npm run dev

# Production build and serve
npm run start
```

## Usage

The server exposes a single tool:

### `transcribe`

Opens a live speech transcription interface.

**Parameters:** None

**Example:**

```json
{
  "name": "transcribe",
  "arguments": {}
}
```

## How It Works

1. Click **Start** to begin listening
2. Speak into your microphone
3. Watch your speech appear as text in real-time (interim text is streamed to model context via `ui/update-model-context`)
4. Click **Send** to send the transcript as a `ui/message` to the host (clears the model context)
5. Click **Clear** to reset the transcript

## Architecture

```
transcript-server/
├── server.ts          # MCP server with transcribe tool
├── server-utils.ts    # HTTP transport utilities
├── mcp-app.html       # Transcript UI entry point
├── src/
│   ├── mcp-app.ts     # App logic, Web Speech API integration
│   ├── mcp-app.css    # Transcript UI styles
│   └── global.css     # Base styles
└── dist/              # Built output (single HTML file)
```

## Notes

- **Microphone Permission**: Requires `allow="microphone"` on the sandbox iframe (configured via `permissions: { microphone: {} }` in the resource `_meta.ui`)
- **Browser Support**: Web Speech API is well-supported in Chrome/Edge, with Safari support. Firefox has limited support.
- **Continuous Mode**: Recognition automatically restarts when it ends, for seamless transcription

## Future Enhancements

- Language selection dropdown
- Whisper-based offline transcription (see TRANSCRIPTION.md)
- Export transcript to file
- Timestamps toggle
