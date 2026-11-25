import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/client/validators/cf-worker";
import {
  AppBridge,
  PostMessageTransport,
  getElicitationUiResourceUri,
  supportsAppElicitation,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  getUiResource,
  loadSandboxProxy,
  type ServerInfo,
} from "./implementation";

type FormParams = Extract<
  ElicitRequest["params"],
  { requestedSchema: unknown }
>;
const validator = new CfWorkerJsonSchemaValidator();
export const ELICITATION_CLIENT_CAPABILITIES = {
  elicitation: { form: {} },
  extensions: {
    "io.modelcontextprotocol/ui": {
      mimeTypes: ["text/html;profile=mcp-app"],
      elicitation: {},
    },
  },
};

function panel(server: string, message: string) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", `Information requested by ${server}`);
  const heading = document.createElement("h2");
  heading.textContent = `Information requested by ${server}`;
  const description = document.createElement("p");
  description.textContent = message;
  const dismiss = document.createElement("button");
  dismiss.textContent = "Cancel";
  dismiss.onclick = () => dialog.close();
  dialog.append(heading, description, dismiss);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** Native fallback for the flat primitive/enum schemas permitted by core form mode. */
async function renderNative(
  server: string,
  params: FormParams,
  signal: AbortSignal,
): Promise<ElicitResult> {
  signal.throwIfAborted();
  const validate = validator.getValidator(params.requestedSchema);
  const dialog = panel(server, params.message);
  const form = document.createElement("form");
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  const fields = Object.entries(params.requestedSchema.properties).map(
    ([name, schema]) => {
      const label = document.createElement("label");
      label.textContent = schema.title ?? name;
      const choices =
        "enum" in schema
          ? schema.enum
          : "oneOf" in schema
            ? schema.oneOf.map((item) => item.const)
            : schema.type === "array"
              ? "enum" in schema.items
                ? schema.items.enum
                : schema.items.anyOf.map((item) => item.const)
              : undefined;
      let input: HTMLInputElement | HTMLSelectElement;
      if (choices) {
        input = document.createElement("select");
        input.multiple = schema.type === "array";
        for (const choice of choices) {
          const option = document.createElement("option");
          option.value = String(choice);
          option.textContent = String(choice);
          input.append(option);
        }
      } else {
        input = document.createElement("input");
        input.type =
          schema.type === "boolean"
            ? "checkbox"
            : schema.type === "number" || schema.type === "integer"
              ? "number"
              : "text";
        if (input.type === "number")
          input.step = schema.type === "integer" ? "1" : "any";
      }
      input.name = name;
      input.required = params.requestedSchema.required?.includes(name) ?? false;
      if (schema.type === "boolean") input.required = false; // false is a valid answer
      if (schema.default !== undefined) {
        if (input instanceof HTMLInputElement && input.type === "checkbox")
          input.checked = Boolean(schema.default);
        else if (
          input instanceof HTMLSelectElement &&
          input.multiple &&
          Array.isArray(schema.default)
        )
          for (const option of input.options)
            option.selected = schema.default.includes(option.value);
        else input.value = String(schema.default);
      }
      label.append(input);
      form.append(label, document.createElement("br"));
      return { name, schema, input };
    },
  );
  const submit = document.createElement("button");
  submit.textContent = "Submit";
  const decline = document.createElement("button");
  decline.type = "button";
  decline.textContent = "Decline";
  form.append(submit, decline, error);
  dialog.append(form);
  let onAbort: () => void = () => {};
  try {
    return await new Promise<ElicitResult>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      dialog.addEventListener("close", () => resolve({ action: "cancel" }), {
        once: true,
      });
      decline.onclick = () => resolve({ action: "decline" });
      form.onsubmit = (event) => {
        event.preventDefault();
        const content: NonNullable<ElicitResult["content"]> = {};
        for (const { name, schema, input } of fields) {
          if (!input.required && !input.value && schema.type !== "boolean")
            continue;
          content[name] =
            input instanceof HTMLSelectElement && input.multiple
              ? Array.from(input.selectedOptions, (o) => o.value)
              : input instanceof HTMLInputElement && input.type === "checkbox"
                ? input.checked
                : schema.type === "number" || schema.type === "integer"
                  ? Number(input.value)
                  : input.value;
        }
        const checked = validate(content);
        if (!checked.valid) {
          error.textContent = checked.errorMessage;
          return;
        }
        resolve({ action: "accept", content });
      };
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
    dialog.remove();
  }
}

async function renderApp(
  server: ServerInfo,
  params: FormParams,
  uri: string,
  operationSignal: AbortSignal,
): Promise<ElicitResult> {
  operationSignal.throwIfAborted();
  const dialog = panel(server.name, params.message);
  const iframe = document.createElement("iframe");
  iframe.title = `Form provided by ${server.name}`;
  iframe.style.cssText = "width:640px;max-width:80vw;height:360px;border:0";
  dialog.append(iframe);
  const dismissed = new AbortController();
  const setup = new AbortController();
  const signal = AbortSignal.any([
    operationSignal,
    dismissed.signal,
    setup.signal,
  ]);
  dialog.addEventListener("close", () =>
    dismissed.abort("User dismissed elicitation"),
  );
  // This self-contained form needs no server-tool forwarding permissions.
  const bridge = new AppBridge(
    null,
    { name: "MCP Apps Host", version: "1" },
    { elicitation: {} },
  );
  let initialized = false;
  const ready = new Promise<void>((resolve) =>
    bridge.addEventListener("initialized", () => {
      initialized = true;
      resolve();
    }),
  );
  const setupTimeout = setTimeout(
    () => setup.abort("App initialization timed out"),
    15000,
  );
  let onAbort: () => void = () => {};
  const abort = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([
      (async () => {
        const resource = await getUiResource(server, uri, signal);
        signal.throwIfAborted();
        await loadSandboxProxy(
          iframe,
          resource.csp,
          resource.permissions,
          signal,
        );
        await bridge.connect(
          new PostMessageTransport(
            iframe.contentWindow!,
            iframe.contentWindow!,
          ),
        );
        await bridge.sendSandboxResourceReady(resource);
        await ready;
      })(),
      abort,
    ]);
    clearTimeout(setupTimeout);
    const result = await Promise.race([
      bridge.requestElicitation(params, { signal }),
      abort,
    ]);
    return result;
  } catch (error) {
    operationSignal.throwIfAborted();
    if (dismissed.signal.aborted) return { action: "cancel" };
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    clearTimeout(setupTimeout);
    if (initialized)
      await bridge.teardownResource({}, { timeout: 1000 }).catch(() => {});
    await bridge.close();
    dialog.remove();
  }
}

/** Each call owns its renderer, bridge, fallback, and cleanup. */
export async function renderElicitation(
  server: ServerInfo,
  params: ElicitRequest["params"],
  signal: AbortSignal,
): Promise<ElicitResult> {
  if (params.mode === "url")
    throw new Error("This example host supports form mode only");
  try {
    if (
      supportsAppElicitation(
        ELICITATION_CLIENT_CAPABILITIES,
        server.client.getServerCapabilities(),
      )
    ) {
      const uri = getElicitationUiResourceUri(params);
      if (uri) return await renderApp(server, params, uri, signal);
    }
  } catch (error) {
    signal.throwIfAborted();
    console.warn("[HOST] App rendering failed; using native form", error);
  }
  return renderNative(server.name, params, signal);
}
