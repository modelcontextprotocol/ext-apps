import { App } from "@modelcontextprotocol/ext-apps";
import type { ElicitResult } from "@modelcontextprotocol/client";
const app = new App({ name: "Delivery window", version: "1" }, {});
app.onelicitation = async (_params, context) =>
  new Promise<ElicitResult>((resolve) => {
    const form = document.querySelector("form")!;
    document.querySelector("fieldset")!.disabled = false;
    form.onsubmit = (event) => {
      event.preventDefault();
      resolve({
        action: "accept",
        content: { window: new FormData(form).get("window") as string },
      });
    };
    document.querySelector<HTMLButtonElement>("#decline")!.onclick = () =>
      resolve({ action: "decline", content: { unused: "must be dropped" } });
    document.querySelector<HTMLButtonElement>("#invalid")!.onclick = () =>
      resolve({ action: "accept", content: { window: "night" } });
    context.mcpReq.signal.addEventListener(
      "abort",
      () => resolve({ action: "cancel" }),
      { once: true },
    );
  });
// Elicitation input arrives through onelicitation; no tool-input notification is needed.
void app.connect();
