import {
  App,
  COMPANION_VIEW,
  McpUiCompanionViewHostCapabilitySchema,
} from "@modelcontextprotocol/ext-apps";
import { showTrail, trails } from "./trails";

const app = new App(
  { name: "Trail Catalog", version: "1.0.0" },
  { experimental: { [COMPANION_VIEW]: { version: 1, role: "parent" } } },
);
const filter = document.querySelector<HTMLInputElement>("#trail-filter")!;
const list = document.querySelector<HTMLUListElement>("#trail-list")!;
const inline = document.querySelector<HTMLElement>("#inline-detail")!;
const hide = document.querySelector<HTMLButtonElement>("#hide-detail")!;

let generation = 0;
let seq = 0;
let selected: string | null = null;
let companion = false;
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
hide.addEventListener("click", () => {
  void setDetail(null);
});

async function setDetail(itemId: string | null) {
  const requestedSeq = ++seq;
  const requestedGeneration = generation;
  hide.disabled = itemId === null;
  inline.hidden = true;
  const fallback = () => {
    const trail = trails.find((trail) => trail.id === itemId);
    if (trail) showTrail(inline, trail, "h2");
  };
  if (!companion) {
    fallback();
    return;
  }
  try {
    const result = await app.setCompanionView({
      generation,
      seq: requestedSeq,
      itemId,
    });
    if (requestedSeq !== seq || requestedGeneration !== generation) return;
    generation = result.generation;
    if (
      result.status === "unavailable" ||
      result.status === "denied" ||
      result.status === "failed"
    )
      fallback();
    if (result.status === "stale") hide.disabled = result.itemId === null;
  } catch (error) {
    console.warn("Companion request failed:", error);
    if (requestedSeq === seq && requestedGeneration === generation) fallback();
  }
}

app.addEventListener("companionviewclosed", (params) => {
  if (params.generation <= generation) return;
  generation = params.generation;
  inline.hidden = true;
  hide.disabled = true;
});
app
  .connect()
  .then(() => {
    const capability = McpUiCompanionViewHostCapabilitySchema.safeParse(
      app.getHostCapabilities()?.experimental?.[COMPANION_VIEW],
    ).data;
    if (capability?.generation !== undefined) {
      generation = capability.generation;
      companion = true;
    }
  })
  .catch((error) =>
    console.warn("Trail Catalog could not connect to its host:", error),
  )
  .finally(() =>
    document.querySelector("main")!.setAttribute("aria-busy", "false"),
  );
