<script lang="ts">
import { onMount } from "svelte";
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function extractTime(result: CallToolResult): string {
  const { text } = result.content?.find((c) => c.type === "text")!;
  return text;
}


let app = $state<App | null>(null);
let hostContext = $state<McpUiHostContext | undefined>();
let serverTime = $state("Loading...");
let messageText = $state("This is message text.");
let logText = $state("This is log text.");
let linkUrl = $state("https://modelcontextprotocol.io/");

// Apply host styles reactively when hostContext changes
$effect(() => {
  if (hostContext?.theme) {
    applyDocumentTheme(hostContext.theme);
  }
  if (hostContext?.styles?.variables) {
    applyHostStyleVariables(hostContext.styles.variables);
  }
  if (hostContext?.styles?.css?.fonts) {
    applyHostFonts(hostContext.styles.css.fonts);
  }
});

onMount(async () => {
  const instance = new App({ name: "Get Time App", version: "1.0.0" });

  instance.ontoolinput = (params) => {
    console.info("Received tool call input:", params);
  };

  instance.ontoolresult = (result) => {
    console.info("Received tool call result:", result);
    serverTime = extractTime(result);
  };

  instance.ontoolcancelled = (params) => {
    console.info("Tool call cancelled:", params.reason);
  };

  instance.onerror = console.error;

  instance.onhostcontextchanged = (params) => {
    hostContext = { ...hostContext, ...params };
  };

  await instance.connect();
  app = instance;
  hostContext = instance.getHostContext();
});

async function handleGetTime() {
  if (!app) return;
  try {
    console.info("Calling get-time tool...");
    const result = await app.callServerTool({ name: "get-time", arguments: {} });
    console.info("get-time result:", result);
    serverTime = extractTime(result);
  } catch (e) {
    console.error(e);
    serverTime = "[ERROR]";
  }
}

async function handleSendMessage() {
  if (!app) return;
  const signal = AbortSignal.timeout(5000);
  try {
    console.info("Sending message text to Host:", messageText);
    const { isError } = await app.sendMessage(
      { role: "user", content: [{ type: "text", text: messageText }] },
      { signal },
    );
    console.info("Message", isError ? "rejected" : "accepted");
  } catch (e) {
    console.error("Message send error:", signal.aborted ? "timed out" : e);
  }
}

async function handleSendLog() {
  if (!app) return;
  console.info("Sending log text to Host:", logText);
  await app.sendLog({ level: "info", data: logText });
}

async function handleOpenLink() {
  if (!app) return;
  console.info("Sending open link request to Host:", linkUrl);
  const { isError } = await app.openLink({ url: linkUrl });
  console.info("Open link request", isError ? "rejected" : "accepted");
}
</script>

<main
  class="main"
  style:padding={hostContext?.safeAreaInsets && `${hostContext.safeAreaInsets.top}px ${hostContext.safeAreaInsets.right}px ${hostContext.safeAreaInsets.bottom}px ${hostContext.safeAreaInsets.left}px`}
>
  <p class="notice">Watch activity in the DevTools console!</p>

  <div class="action">
    <p><strong>Server Time:</strong> <code class="server-time">{serverTime}</code></p>
    <button onclick={handleGetTime}>Get Server Time</button>
  </div>

  <div class="action">
    <textarea bind:value={messageText}></textarea>
    <button onclick={handleSendMessage}>Send Message</button>
  </div>

  <div class="action">
    <input type="text" bind:value={logText}>
    <button onclick={handleSendLog}>Send Log</button>
  </div>

  <div class="action">
    <input type="url" bind:value={linkUrl}>
    <button onclick={handleOpenLink}>Open Link</button>
  </div>
</main>

<style>
.main {
  width: 100%;
  max-width: 425px;
  box-sizing: border-box;

  > * {
    margin-top: 0;
    margin-bottom: 0;
  }

  > * + * {
    margin-top: var(--spacing-lg);
  }
}

.action {
  > * {
    margin-top: 0;
    margin-bottom: 0;
    width: 100%;
  }

  > * + * {
    margin-top: var(--spacing-sm);
  }

  /* Server time row: flex layout for consistent mask width in E2E tests */
  > p {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-xs);
  }

  textarea,
  input {
    display: block;
    font-family: inherit;
    font-size: inherit;
  }

  button {
    padding: var(--spacing-sm) var(--spacing-md);
    border: none;
    border-radius: var(--border-radius-md);
    color: var(--color-text-on-accent);
    font-weight: var(--font-weight-bold);
    background-color: var(--color-accent);
    cursor: pointer;

    &:hover {
      background-color: color-mix(in srgb, var(--color-accent) 85%, var(--color-background-inverse));
    }

    &:focus-visible {
      outline: calc(var(--border-width-regular) * 2) solid var(--color-ring-primary);
      outline-offset: var(--border-width-regular);
    }
  }
}

.notice {
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--color-text-info);
  text-align: center;
  font-style: italic;
  background-color: var(--color-background-info);

  &::before {
    content: "ℹ️ ";
    font-style: normal;
  }
}

/* Server time fills remaining width for consistent E2E screenshot masking */
.server-time {
  flex: 1;
  min-width: 0;
}
</style>
