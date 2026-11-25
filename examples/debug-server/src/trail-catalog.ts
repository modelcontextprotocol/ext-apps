import { App, OPEN_VIEW } from "@modelcontextprotocol/ext-apps";
import { showTrail, trails } from "./trails";

const app = new App(
  { name: "Trail Catalog", version: "1.0.0" },
  { experimental: { [OPEN_VIEW]: { version: 1, role: "source" } } },
);
const filter = document.querySelector<HTMLInputElement>("#trail-filter")!;
const list = document.querySelector<HTMLUListElement>("#trail-list")!;
const inline = document.querySelector<HTMLElement>("#inline-detail")!;
const status = document.querySelector<HTMLElement>("#detail-status")!;

let selected: string | null = null;
const rows = new Map<string, HTMLLIElement>();
for (const trail of trails) {
  const row = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.textContent = trail.name;
  button.addEventListener("click", () => {
    selected = trail.id;
    for (const [id, row] of rows) {
      row.firstElementChild!.setAttribute(
        "aria-pressed",
        String(id === selected),
      );
    }
    void setDetail(trail.id);
  });
  row.append(button);
  rows.set(trail.id, row);
  list.append(row);
}
filter.addEventListener("input", () => {
  const query = filter.value.trim().toLowerCase();
  for (const trail of trails)
    rows.get(trail.id)!.hidden = !trail.name.toLowerCase().includes(query);
});
async function setDetail(itemId: string) {
  status.textContent = "";
  inline.hidden = true;
  const fallback = (message: string) => {
    status.textContent = message;
    const trail = trails.find((trail) => trail.id === itemId);
    if (trail) showTrail(inline, trail, "h2");
  };
  try {
    const result = await app.openView({
      target: "trail-detail",
      input: { itemId },
    });
    switch (result.status) {
      case "unavailable":
        fallback("A separate detail view is unavailable.");
        break;
      case "denied":
        fallback("The host declined to open a separate detail view.");
        break;
      case "failed":
        fallback("The separate detail view could not load.");
        break;
    }
  } catch (error) {
    console.warn("Open View request failed:", error);
    fallback("The separate detail view could not load.");
  }
}

app
  .connect()
  .catch((error) =>
    console.warn("Trail Catalog could not connect to its host:", error),
  )
  .finally(() =>
    document.querySelector("main")!.setAttribute("aria-busy", "false"),
  );
