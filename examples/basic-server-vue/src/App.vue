<script setup lang="ts">
import { ref, onMounted, watchEffect } from "vue";
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


const app = ref<App | null>(null);
const hostContext = ref<McpUiHostContext | undefined>();
const serverTime = ref("Loading...");
const messageText = ref("This is message text.");
const logText = ref("This is log text.");
const linkUrl = ref("https://modelcontextprotocol.io/");

// Apply host styles reactively when hostContext changes
watchEffect(() => {
  const ctx = hostContext.value;
  if (ctx?.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx?.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx?.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
});

onMounted(async () => {
  const instance = new App({ name: "Get Time App", version: "1.0.0" });

  instance.ontoolinput = (params) => {
    console.info("Received tool call input:", params);
  };

  instance.ontoolresult = (result) => {
    console.info("Received tool call result:", result);
    serverTime.value = extractTime(result);
  };

  instance.ontoolcancelled = (params) => {
    console.info("Tool call cancelled:", params.reason);
  };

  instance.onerror = console.error;

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
    console.info("Calling get-time tool...");
    const result = await app.value.callServerTool({ name: "get-time", arguments: {} });
    console.info("get-time result:", result);
    serverTime.value = extractTime(result);
  } catch (e) {
    console.error(e);
    serverTime.value = "[ERROR]";
  }
}

async function handleSendMessage() {
  if (!app.value) return;
  const signal = AbortSignal.timeout(5000);
  try {
    console.info("Sending message text to Host:", messageText.value);
    const { isError } = await app.value.sendMessage(
      { role: "user", content: [{ type: "text", text: messageText.value }] },
      { signal },
    );
    console.info("Message", isError ? "rejected" : "accepted");
  } catch (e) {
    console.error("Message send error:", signal.aborted ? "timed out" : e);
  }
}

async function handleSendLog() {
  if (!app.value) return;
  console.info("Sending log text to Host:", logText.value);
  await app.value.sendLog({ level: "info", data: logText.value });
}

async function handleOpenLink() {
  if (!app.value) return;
  console.info("Sending open link request to Host:", linkUrl.value);
  const { isError } = await app.value.openLink({ url: linkUrl.value });
  console.info("Open link request", isError ? "rejected" : "accepted");
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
      <p><strong>Server Time:</strong> <code class="server-time">{{ serverTime }}</code></p>
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
