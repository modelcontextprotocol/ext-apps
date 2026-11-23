import { App, COMPANION_VIEW } from "@modelcontextprotocol/ext-apps";
import { showTrail, trails } from "./trails";

const app = new App(
  { name: "Trail Detail", version: "1.0.0" },
  { experimental: { [COMPANION_VIEW]: { version: 1, role: "detail" } } },
);
const detail = document.querySelector<HTMLElement>("#trail-detail")!;
app.onteardown = () => ({});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void app
      .requestTeardown()
      .catch((error) =>
        console.warn("Could not request detail dismissal:", error),
      );
  }
});
app
  .connect()
  .then(() => {
    const itemId = app.getHostContext()?.companionView?.itemId;
    const trail = trails.find((trail) => trail.id === itemId);
    if (trail) showTrail(detail, trail, "h1");
    else detail.textContent = "Trail not found.";
  })
  .catch((error) => {
    console.warn("Trail Detail could not connect to its host:", error);
    detail.textContent = "Trail detail could not load.";
  });
