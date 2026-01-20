# Debug Server

A comprehensive testing/debugging tool for the MCP Apps SDK that exercises every capability, callback, and result format combination.

## Tools

### debug-tool

Configurable tool for testing all result variations:

| Parameter                  | Type                                                                                | Default  | Description                                 |
| -------------------------- | ----------------------------------------------------------------------------------- | -------- | ------------------------------------------- |
| `contentType`              | `"text"` \| `"image"` \| `"audio"` \| `"resource"` \| `"resourceLink"` \| `"mixed"` | `"text"` | Content block type to return                |
| `multipleBlocks`           | boolean                                                                             | `false`  | Return 3 content blocks                     |
| `includeStructuredContent` | boolean                                                                             | `true`   | Include structuredContent in result         |
| `includeMeta`              | boolean                                                                             | `false`  | Include \_meta in result                    |
| `largeInput`               | string                                                                              | -        | Large text input (tests tool-input-partial) |
| `simulateError`            | boolean                                                                             | `false`  | Return isError: true                        |
| `delayMs`                  | number                                                                              | -        | Delay before response (ms)                  |

### debug-refresh

App-only tool (hidden from model) for polling server state. Returns current timestamp and call counter.

## App UI

The debug app provides a dashboard with:

- **Event Log**: Real-time log of all SDK events with filtering
- **Host Info**: Context, capabilities, container dimensions, styles
- **Callback Status**: Table of all callbacks with call counts
- **Actions**: Buttons to test every SDK method:
  - Send messages (text/image)
  - Logging (debug/info/warning/error)
  - Model context updates
  - Display mode requests
  - Link opening
  - Resize controls
  - Server tool calls
  - File operations

## Usage

```bash
# Build
npm run --workspace examples/debug-server build

# Run standalone
npm run --workspace examples/debug-server serve

# Run with all examples
npm start
```

Then open `http://localhost:8080/basic-host/` and select "Debug MCP App Server" from the dropdown.
