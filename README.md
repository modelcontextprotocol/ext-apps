# @modelcontextprotocol/ext-apps

This repo contains the SDK and [specification](./specification/draft/apps.mdx) for MCP Apps Extension ([SEP-1865](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)).

MCP Apps are proposed standard inspired by [MCP-UI](https://mcpui.dev/) and [OpenAI's Apps SDK](https://developers.openai.com/apps-sdk/) to allow MCP Servers to display interactive UI elements in conversational MCP clients / chatbots.

This repo provides:

- [specification/draft/apps.mdx](./specification/draft/apps.mdx): The Draft Extension Specification. It's still... in flux! Feedback welcome! (also see discussions in [SEP-1865](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)).

- [types.ts](./src/types.ts): Types of JSON-RPC messages used to communicate between Apps & their host
  - Note that MCP Apps also use some standard MCP messages (e.g. `tools/call` for the App to trigger actions on its originating Server - these calls are proxied through the Host), but these types are the additional messages defined by the extension
- [examples/simple-example](./examples/simple-server): Example Server + Apps
  - [server.ts](./examples/simple-server/server.ts): MCP server with three tools that declare UI resources of Apps to be show in the chat when called
  - [ui-react.tsx](./examples/simple-server/src/ui-react.tsx): React App returned by the `create-ui-react` tool shows how to use the `useApp` hook to register MCP callbacks
  - [ui-vanilla.tsx](./examples/simple-server/src/ui-vanilla.ts): vanilla App returned by the `create-ui-vanilla`
  - [ui-raw.tsx](./examples/simple-server/src/ui-raw.ts): same as vanilla App but doesn't use the SDK runtime (just its types)

- [examples/simple-host](./examples/simple-host): bare-bone examples on how to host MCP Apps (both use the [AppBridge](./src/app-bridge.ts) class to talk to a hosted App)
  - [example-host-react.tsx](./examples/simple-host/src/example-host-react.tsx) uses React (esp. [AppRenderer.tsx](./examples/simple-host/src/AppRenderer.tsx))
  - [example-host-vanilla.tsx](./examples/simple-host/src/example-host-vanilla.tsx) doesn't use React

- [message-transport](./src/message-transport.ts): `PostMessageTransport` class that uses `postMessage` to exchange JSON-RPC messages between windows / iframes

- [app.ts](./src/app.ts): `App` class used by an App to talk to its host

- [app-bridge.ts](./src/app-bridge.ts): `AppBridge` class used by the host to talk to a single App

- _Soon_: more examples!

What this repo does NOT provide:

- There's no _supported_ host implementation in this repo (beyond the [examples/simple-host](./examples/simple-host) example)
  - We have [contributed a tentative implementation](https://github.com/MCP-UI-Org/mcp-ui/pull/147) of hosting / iframing / sandboxing logic to the [MCP-UI](https://github.com/idosal/mcp-ui) repository, and expect OSS clients may use it, while other clients might roll their own hosting logic.

## Using the SDK

### Run examples

Run the examples in this repo end-to-end:

```
npm i
npm start
```

open http://localhost:8080/

> [!NOTE]  
> Please bear with us while we add more examples!

### Using the SDK in your project

This repo is in flux and isn't published to npm yet: when it is, it will use the `@modelcontextprotocol/ext-apps` package.

In the meantime you can depend on the SDK library in a Node.js project by installing it w/ its git URL:

```bash
npm install -S git+https://github.com/modelcontextprotocol/ext-apps.git
```

Your `package.json` will then look like:

```json
{
  ...
  "dependencies": {
    ...
    "@modelcontextprotocol/ext-apps": "git+https://github.com/modelcontextprotocol/ext-apps.git"
  }
}
```

> [!NOTE]  
> The build tools (`esbuild`, `tsx`, `typescript`) are in `dependencies` rather than `devDependencies`. This is intentional: it allows the `prepare` script to run when the package is installed from git, since npm doesn't install devDependencies for git dependencies.
>
> Once the package is published to npm with pre-built `dist/`, these can be moved back to `devDependencies`.
