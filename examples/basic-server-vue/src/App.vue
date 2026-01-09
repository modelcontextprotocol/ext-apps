<script setup lang="ts">
import { ref, onMounted } from "vue";
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

const app = ref<App | null>(null);
const hostContext = ref<McpUiHostContext | undefined>();
const serverTime = ref("Loading...");
const messageText = ref("This is message text.");
const logText = ref("This is log text.");
const linkUrl = ref("https://modelcontextprotocol.io/");

onMounted(async () => {
  const instance = new App({ name: "Get Time App", version: "1.0.0" });

  instance.ontoolinput = (params) => {
    log.info("Received tool call input:", params);
  };

  instance.ontoolresult = (result) => {
    log.info("Received tool call result:", result);
    serverTime.value = extractTime(result);
  };

  instance.onerror = log.error;

  instance.onhostcontextchanged = (params) => {
    hostContext.value = { ...hostContext.value, ...params };
  };

  await instance.connect();
  app.value = instance;
  hostContext.value = instance.getHostContext();
});

async function handleGetTime() {
  if (!app.value) return;
  try {
    log.info("Calling get-time tool...");
    const result = await app.value.callServerTool({ name: "get-time", arguments: {} });
    log.info("get-time result:", result);
    serverTime.value = extractTime(result);
  } catch (e) {
    log.error(e);
    serverTime.value = "[ERROR]";
  }
}

async function handleSendMessage() {
  if (!app.value) return;
  const signal = AbortSignal.timeout(5000);
  try {
    log.info("Sending message text to Host:", messageText.value);
    const { isError } = await app.value.sendMessage(
      { role: "user", content: [{ type: "text", text: messageText.value }] },
      { signal },
    );
    log.info("Message", isError ? "rejected" : "accepted");
  } catch (e) {
    log.error("Message send error:", signal.aborted ? "timed out" : e);
  }
}

async function handleSendLog() {
  if (!app.value) return;
  log.info("Sending log text to Host:", logText.value);
  await app.value.sendLog({ level: "info", data: logText.value });
}

async function handleOpenLink() {
  if (!app.value) return;
  log.info("Sending open link request to Host:", linkUrl.value);
  const { isError } = await app.value.openLink({ url: linkUrl.value });
  log.info("Open link request", isError ? "rejected" : "accepted");
}
</script>

<template>
  <main
    class="main"
    :style="hostContext?.safeAreaInsets && {
      paddingTop: hostContext.safeAreaInsets.top + 'px',
      paddingRight: hostContext.safeAreaInsets.right + 'px',
      paddingBottom: hostContext.safeAreaInsets.bottom + 'px',
      paddingLeft: hostContext.safeAreaInsets.left + 'px',
    }"
  >
    <p class="notice">Watch activity in the DevTools console!</p>

    <div class="action">
      <p><strong>Server Time:</strong> <code id="server-time">{{ serverTime }}</code></p>
      <button @click="handleGetTime">Get Server Time</button>
    </div>

    <div class="action">
      <textarea v-model="messageText"></textarea>
      <button @click="handleSendMessage">Send Message</button>
    </div>

    <div class="action">
      <input type="text" v-model="logText">
      <button @click="handleSendLog">Send Log</button>
    </div>

    <div class="action">
      <input type="url" v-model="linkUrl">
      <button @click="handleOpenLink">Open Link</button>
    </div>
  </main>
</template>

<style scoped>
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
