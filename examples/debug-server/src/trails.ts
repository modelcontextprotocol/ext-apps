import "./trails.css";

export const trails = [
  {
    id: "c01",
    name: "Cedar Loop",
    summary: "2.4 mi · Easy",
    description: "A short loop through cedar groves and along a quiet creek.",
  },
  {
    id: "q02",
    name: "Quartz Ridge",
    summary: "5.1 mi · Moderate",
    description: "A gradual climb to an open ridge with views of the valley.",
  },
];

export function showTrail(
  container: HTMLElement,
  trail: (typeof trails)[number],
  heading: "h1" | "h2",
) {
  const title = document.createElement(heading);
  title.textContent = trail.name;
  const summary = document.createElement("p");
  summary.textContent = trail.summary;
  const description = document.createElement("p");
  description.textContent = trail.description;
  container.replaceChildren(title, summary, description);
  container.hidden = false;
}
