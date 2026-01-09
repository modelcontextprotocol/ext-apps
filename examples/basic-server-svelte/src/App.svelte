<script lang="ts">
import { onMount } from "svelte";
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const log = {
  info: console.log.bind(console, "[APP]"),
  warn: console.warn.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};

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

onMount(async () => {
  const instance = new App({ name: "Get Time App", version: "1.0.0" });

  instance.ontoolinput = (params) => {
    log.info("Received tool call input:", params);
  };

  instance.ontoolresult = (result) => {
    log.info("Received tool call result:", result);
    serverTime = extractTime(result);
  };

  instance.onerror = log.error;

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
    log.info("Calling get-time tool...");
    const result = await app.callServerTool({ name: "get-time", arguments: {} });
    log.info("get-time result:", result);
    serverTime = extractTime(result);
  } catch (e) {
    log.error(e);
    serverTime = "[ERROR]";
  }
}

async function handleSendMessage() {
  if (!app) return;
  const signal = AbortSignal.timeout(5000);
  try {
    log.info("Sending message text to Host:", messageText);
    const { isError } = await app.sendMessage(
      { role: "user", content: [{ type: "text", text: messageText }] },
      { signal },
    );
    log.info("Message", isError ? "rejected" : "accepted");
  } catch (e) {
    log.error("Message send error:", signal.aborted ? "timed out" : e);
  }
}

async function handleSendLog() {
  if (!app) return;
  log.info("Sending log text to Host:", logText);
  await app.sendLog({ level: "info", data: logText });
}

async function handleOpenLink() {
  if (!app) return;
  log.info("Sending open link request to Host:", linkUrl);
  const { isError } = await app.openLink({ url: linkUrl });
  log.info("Open link request", isError ? "rejected" : "accepted");
}
</script>

<main
  class="main"
  style:padding={hostContext?.safeAreaInsets && `${hostContext.safeAreaInsets.top}px ${hostContext.safeAreaInsets.right}px ${hostContext.safeAreaInsets.bottom}px ${hostContext.safeAreaInsets.left}px`}
>
  <p class="notice">Watch activity in the DevTools console!</p>

  <div class="action">
    <p><strong>Server Time:</strong> <code id="server-time">{serverTime}</code></p>
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
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-notice-bg: #eff6ff;

  width: 100%;
  max-width: 425px;
  box-sizing: border-box;

  > * {
    margin-top: 0;
    margin-bottom: 0;
  }

  > * + * {
    margin-top: 1.5rem;
  }
}

.action {
  > * {
    margin-top: 0;
    margin-bottom: 0;
    width: 100%;
  }

  > * + * {
    margin-top: 0.5rem;
  }

  textarea,
  input {
    font-family: inherit;
    font-size: inherit;
  }

  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    color: white;
    font-weight: bold;
    background-color: var(--color-primary);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background-color: var(--color-primary-hover);
    }
  }
}

.notice {
  padding: 0.5rem 0.75rem;
  color: var(--color-primary);
  text-align: center;
  font-style: italic;
  background-color: var(--color-notice-bg);

  &::before {
    content: "ℹ️ ";
    font-style: normal;
  }
}
</style>
