/**
 * @file A generic dynamic content renderer.
 *
 * This view contains no flight-specific presentation logic. It interprets
 * declarative payload documents (see ../dynamic-ui.ts) extracted from tool
 * results with `getViewContentBlocks`, and bridges payload-level button
 * actions back into `tools/call` requests. The same pattern applies to real
 * generative UI formats such as A2UI.
 *
 * Security note: payloads are untrusted input. The renderer builds DOM with
 * `createElement`/`textContent` only — never `innerHTML` of payload-derived
 * strings.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  getViewContentBlocks,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  DYNAMIC_UI_MIME_TYPE,
  type UiComponent,
  type UiSurface,
} from "../dynamic-ui";
import "./global.css";
import "./mcp-app.css";

const mainEl = document.querySelector(".main") as HTMLElement;
const surfaceEl = document.getElementById("surface")!;

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

const app = new App({ name: "Dynamic Content Renderer", version: "1.0.0" });

function setStatus(text: string) {
  surfaceEl.replaceChildren();
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = text;
  surfaceEl.append(status);
}

/** The event bridge: payload-level actions become MCP tool calls. */
async function invokeAction(action: {
  tool: string;
  arguments: Record<string, unknown>;
}) {
  surfaceEl.classList.add("busy");
  try {
    const result = await app.callServerTool({
      name: action.tool,
      arguments: action.arguments,
    });
    applyToolResult(result);
  } catch (e) {
    console.error("Action failed:", e);
    setStatus("Something went wrong — check the console.");
  } finally {
    surfaceEl.classList.remove("busy");
  }
}

function renderComponent(component: UiComponent): HTMLElement {
  switch (component.kind) {
    case "text": {
      const variant = component.variant ?? "body";
      const el = document.createElement(variant === "title" ? "h3" : "p");
      el.className = `text text-${variant}`;
      el.textContent = component.text;
      return el;
    }
    case "row":
    case "column":
    case "card": {
      const el = document.createElement("div");
      el.className = component.kind;
      el.append(...component.children.map(renderComponent));
      return el;
    }
    case "button": {
      const el = document.createElement("button");
      el.textContent = component.label;
      el.addEventListener("click", () => invokeAction(component.action));
      return el;
    }
    default: {
      // Unknown component kinds are skipped, not errors: payload formats
      // evolve independently of the renderer.
      const el = document.createElement("span");
      el.hidden = true;
      return el;
    }
  }
}

function renderSurface(document_: UiSurface) {
  surfaceEl.replaceChildren(...document_.surface.map(renderComponent));
}

/** Extract marked payloads from any tool result and render them in order. */
function applyToolResult(result: CallToolResult) {
  const payloads = getViewContentBlocks(result, {
    mimeType: DYNAMIC_UI_MIME_TYPE,
  });
  if (payloads.length === 0) {
    console.info("Tool result carried no dynamic content payloads:", result);
    return;
  }
  for (const block of payloads) {
    if ("text" in block.resource) {
      try {
        renderSurface(JSON.parse(block.resource.text) as UiSurface);
      } catch (e) {
        console.error("Invalid payload from", block.resource.uri, e);
      }
    }
  }
}

app.ontoolinput = (params) => {
  console.info("Received tool call input:", params);
  setStatus("Searching…");
};

app.ontoolresult = (result) => {
  console.info("Received tool call result:", result);
  applyToolResult(result);
};

app.ontoolcancelled = (params) => {
  console.info("Tool call cancelled:", params.reason);
  setStatus("Cancelled.");
};

app.onerror = console.error;
app.onhostcontextchanged = handleHostContextChanged;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
