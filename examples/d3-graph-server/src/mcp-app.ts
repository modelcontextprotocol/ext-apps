/**
 * D3 Force-Directed Graph Visualization for MCP Apps
 */
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as d3 from "d3";
import "./global.css";
import "./mcp-app.css";

// Types
interface GraphNode {
  id: string;
  group: string;
  size: number;
  description?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  strength: number;
}

interface GraphData {
  graphId: string;
  nodes: GraphNode[];
  links: GraphLink[];
  metadata: {
    title: string;
    description: string;
  };
}

// Color scheme for node groups
const GROUP_COLORS: Record<string, string> = {
  // dependencies graph
  core: "#ef4444",
  viz: "#8b5cf6",
  tooling: "#3b82f6",
  runtime: "#10b981",
  util: "#f59e0b",
  styling: "#ec4899",
  // org-chart graph
  executive: "#dc2626",
  management: "#2563eb",
  lead: "#7c3aed",
  ic: "#059669",
  // knowledge graph
  ai: "#6366f1",
  architecture: "#0891b2",
  tools: "#65a30d",
  application: "#ea580c",
};

// Logging
const log = {
  info: console.log.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};

// DOM Elements
const graphSelect = document.getElementById(
  "graph-select",
) as HTMLSelectElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const graphContainer = document.getElementById("graph-container")!;
const svg = d3.select<SVGSVGElement, unknown>("#graph");
const tooltip = document.getElementById("tooltip")!;

// State
let currentGraphData: GraphData | null = null;
let simulation: d3.Simulation<GraphNode, GraphLink> | null = null;

// Create main group for zoom/pan
const g = svg.append("g");

// Create groups for links and nodes (in order)
const linksGroup = g.append("g").attr("class", "links");
const nodesGroup = g.append("g").attr("class", "nodes");

// Zoom behavior
const zoom = d3
  .zoom<SVGSVGElement, unknown>()
  .scaleExtent([0.1, 4])
  .on("zoom", (event) => {
    g.attr("transform", event.transform.toString());
  });

svg.call(zoom);

// Extract data from tool result
function extractGraphData(result: CallToolResult): GraphData | null {
  const textContent = result.content?.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") return null;
  try {
    return JSON.parse(textContent.text) as GraphData;
  } catch {
    log.error("Failed to parse graph data");
    return null;
  }
}

// Get node color by group
function getNodeColor(group: string): string {
  return GROUP_COLORS[group] ?? "#64748b";
}

// Update tooltip content safely (no innerHTML)
function updateTooltip(node: GraphNode): void {
  // Clear existing content
  tooltip.textContent = "";

  // Create title element
  const title = document.createElement("strong");
  title.textContent = node.id;
  tooltip.appendChild(title);

  // Add line break
  tooltip.appendChild(document.createElement("br"));

  // Add description
  const desc = document.createTextNode(node.description ?? node.group);
  tooltip.appendChild(desc);
}

// Render the graph
function renderGraph(data: GraphData): void {
  currentGraphData = data;

  // Clear existing
  linksGroup.selectAll("*").remove();
  nodesGroup.selectAll("*").remove();

  // Stop previous simulation
  if (simulation) {
    simulation.stop();
  }

  const width = graphContainer.clientWidth;
  const height = graphContainer.clientHeight;

  // Create simulation
  simulation = d3
    .forceSimulation<GraphNode>(data.nodes)
    .force(
      "link",
      d3
        .forceLink<GraphNode, GraphLink>(data.links)
        .id((d) => d.id)
        .strength((d) => (d.strength as number) * 0.5),
    )
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "collision",
      d3.forceCollide<GraphNode>().radius((d) => d.size + 5),
    );

  // Draw links
  const links = linksGroup
    .selectAll<SVGLineElement, GraphLink>("line")
    .data(data.links)
    .join("line")
    .attr("class", "link")
    .attr("stroke-width", (d) => Math.max(1, (d.strength as number) * 3));

  // Draw nodes
  const nodeGroups = nodesGroup
    .selectAll<SVGGElement, GraphNode>("g")
    .data(data.nodes)
    .join("g")
    .attr("cursor", "pointer");

  // Node circles
  nodeGroups
    .append("circle")
    .attr("class", "node")
    .attr("r", (d) => d.size / 2)
    .attr("fill", (d) => getNodeColor(d.group))
    .on("mouseover", (_event, d) => {
      updateTooltip(d);
      tooltip.classList.add("visible");
    })
    .on("mousemove", (event) => {
      tooltip.style.left = `${event.pageX + 12}px`;
      tooltip.style.top = `${event.pageY - 12}px`;
    })
    .on("mouseout", () => {
      tooltip.classList.remove("visible");
    })
    .on("click", async (_event, d) => {
      // Re-center graph on clicked node
      log.info(`Clicked node: ${d.id}, loading centered view...`);
      try {
        await app.callServerTool({
          name: "get-graph-data",
          arguments: {
            graphId: currentGraphData?.graphId,
            centerNode: d.id,
            depth: 2,
          },
        });
      } catch (e) {
        log.error("Failed to load centered graph:", e);
      }
    });

  // Node labels (for larger nodes)
  nodeGroups
    .filter((d) => d.size >= 24)
    .append("text")
    .attr("class", "node-label")
    .attr("dy", (d) => d.size / 2 + 14)
    .text((d) => d.id);

  // Drag behavior
  const drag = d3
    .drag<SVGGElement, GraphNode>()
    .on("start", (event, d) => {
      if (!event.active) simulation!.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation!.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });

  nodeGroups.call(drag);

  // Update positions on tick
  simulation.on("tick", () => {
    links
      .attr("x1", (d) => (d.source as GraphNode).x!)
      .attr("y1", (d) => (d.source as GraphNode).y!)
      .attr("x2", (d) => (d.target as GraphNode).x!)
      .attr("y2", (d) => (d.target as GraphNode).y!);

    nodeGroups.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });
}

// Reset view to initial zoom
function resetView(): void {
  svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
}

// Event listeners
graphSelect.addEventListener("change", async () => {
  const graphId = graphSelect.value;
  log.info(`Loading graph: ${graphId}`);
  try {
    await app.callServerTool({
      name: "get-graph-data",
      arguments: { graphId },
    });
  } catch (e) {
    log.error("Failed to load graph:", e);
  }
});

resetBtn.addEventListener("click", resetView);

// Handle window resize
window.addEventListener("resize", () => {
  if (currentGraphData && simulation) {
    const width = graphContainer.clientWidth;
    const height = graphContainer.clientHeight;
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
    simulation.alpha(0.3).restart();
  }
});

// Create MCP App
const app = new App({ name: "D3 Graph Explorer", version: "1.0.0" });

app.ontoolresult = (result) => {
  log.info("Received graph data");
  const data = extractGraphData(result);
  if (data) {
    renderGraph(data);
    // Update select to match current graph
    if (data.graphId && graphSelect.value !== data.graphId) {
      graphSelect.value = data.graphId;
    }
  }
};

app.onerror = log.error;

// Connect to host
app.connect();
