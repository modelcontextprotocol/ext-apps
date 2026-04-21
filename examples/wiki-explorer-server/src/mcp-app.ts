/**
 * Wiki Explorer - Force-directed graph visualization of Wikipedia link networks
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
} from "d3-force-3d";
import ForceGraph, { type LinkObject, type NodeObject } from "force-graph";
import "./global.css";
import "./mcp-app.css";

// =============================================================================
// Helpers & Types
// =============================================================================

// Helper to resolve CSS variables for canvas rendering
function getCSSColor(varName: string): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim() || "#000"
  );
}

// Types
type NodeState = "default" | "expanded" | "error";

interface NodeData extends NodeObject {
  url: string;
  title: string;
  state: NodeState;
  errorMessage?: string;
}

interface LinkData extends LinkObject {
  source: string | NodeData;
  target: string | NodeData;
}

interface GraphData {
  nodes: NodeData[];
  links: LinkData[];
}

type PageInfo = { url: string; title: string };
type ToolResponse = {
  page: PageInfo;
  links: PageInfo[];
  error: string | null;
};

// =============================================================================
// Graph State & DOM References
// =============================================================================
const graphData: GraphData = { nodes: [], links: [] };
let selectedNodeUrl: string | null = null;
let initialUrl: string | null = null;

// DOM elements
const container = document.getElementById("graph")!;
const popup = document.getElementById("popup")!;
const popupTitle = popup.querySelector(".popup-title")!;
const popupError = popup.querySelector(".popup-error")! as HTMLElement;
const openBtn = document.getElementById("open-btn")!;
const expandBtn = document.getElementById("expand-btn")!;
const zoomInBtn = document.getElementById("zoom-in")!;
const zoomOutBtn = document.getElementById("zoom-out")!;
const resetBtn = document.getElementById("reset-graph")!;

// =============================================================================
// Force-Graph Initialization
// =============================================================================
const graph = new ForceGraph<NodeData, LinkData>(container)
  .nodeId("url")
  .nodeLabel("title")
  .nodeColor((node: NodeData) => {
    switch (node.state) {
      case "expanded":
        return getCSSColor("--node-expanded");
      case "error":
        return getCSSColor("--node-error");
      default:
        return getCSSColor("--node-default");
    }
  })
  .nodeVal(8)
  .linkDirectionalArrowLength(6)
  .linkDirectionalArrowRelPos(1)
  .linkColor(() => getCSSColor("--link-color"))
  .onNodeClick(handleNodeClick)
  .onBackgroundClick(() => hidePopup())
  // Configure forces for better node spreading
  .d3Force("charge", forceManyBody().strength(-80))
  .d3Force("link", forceLink().distance(60))
  .d3Force("collide", forceCollide(12))
  .d3Force("center", forceCenter())
  .d3VelocityDecay(0.3)
  .cooldownTime(Infinity)
  .d3AlphaMin(0)
  .d3Force("ambient", () => {
    for (const node of graphData.nodes) {
      if (node.vx !== undefined && node.vy !== undefined) {
        node.vx += (Math.random() - 0.5) * 0.1;
        node.vy += (Math.random() - 0.5) * 0.1;
      }
    }
  })
  .graphData(graphData);

// Prevent touch events from propagating to the parent scroll view.
// force-graph uses pointer events, which don't suppress native scroll gesture
// recognition on touch devices.
const graphCanvas = container.querySelector("canvas");
if (graphCanvas) {
  for (const eventName of ["touchstart", "touchmove"] as const) {
    graphCanvas.addEventListener(eventName, (e) => e.preventDefault(), {
      passive: false,
    });
  }
}

// Handle window resize
function handleResize() {
  const { width, height } = container.getBoundingClientRect();
  graph.width(width).height(height);
}
window.addEventListener("resize", handleResize);
handleResize();

// =============================================================================
// Graph Data Management
// =============================================================================
function addNode(
  url: string,
  title: string,
  state: NodeState = "default",
  initialPos?: { x: number; y: number },
): boolean {
  const existing = graphData.nodes.find((n) => n.url === url);
  if (existing) {
    return false;
  }
  const node: NodeData = { url, title, state };
  if (initialPos) {
    // Small random jitter so nodes don't stack exactly
    node.x = initialPos.x + (Math.random() - 0.5) * 20;
    node.y = initialPos.y + (Math.random() - 0.5) * 20;
  }
  graphData.nodes.push(node);
  return true;
}

function updateNodeTitle(url: string, title: string): void {
  const node = graphData.nodes.find((n) => n.url === url);
  if (node) {
    node.title = title;
  }
}

function setNodeState(
  url: string,
  state: NodeState,
  errorMessage?: string,
): void {
  const node = graphData.nodes.find((n) => n.url === url);
  if (node) {
    node.state = state;
    node.errorMessage = errorMessage;
  }
}

function addEdge(sourceUrl: string, targetUrl: string): boolean {
  const existing = graphData.links.find((l) => {
    const src =
      typeof l.source === "string" ? l.source : (l.source as NodeData).url;
    const tgt =
      typeof l.target === "string" ? l.target : (l.target as NodeData).url;
    return src === sourceUrl && tgt === targetUrl;
  });
  if (existing) {
    return false;
  }
  graphData.links.push({ source: sourceUrl, target: targetUrl });
  return true;
}

function updateGraph(): void {
  graph.graphData({ nodes: [...graphData.nodes], links: [...graphData.links] });
}

// =============================================================================
// Popup Management
// =============================================================================
function showPopup(node: NodeData, x: number, y: number): void {
  popupTitle.textContent = node.title;

  if (node.state === "error") {
    popupError.textContent = node.errorMessage || "Failed to load page";
    popupError.style.display = "block";
    expandBtn.style.display = "none";
  } else {
    popupError.style.display = "none";
    expandBtn.style.display = "inline-block";

    if (node.state === "expanded") {
      expandBtn.setAttribute("disabled", "true");
      expandBtn.textContent = "Expanded";
    } else {
      expandBtn.removeAttribute("disabled");
      expandBtn.textContent = "Expand";
    }
  }

  popup.style.display = "block";
  const rect = popup.getBoundingClientRect();
  const gap = 15;

  // Place popup on opposite side of cursor from screen center
  const left =
    x < window.innerWidth / 2
      ? x + gap // cursor on left half → popup to right
      : x - rect.width - gap; // cursor on right half → popup to left

  const top =
    y < window.innerHeight / 2
      ? y + gap // cursor on top half → popup below
      : y - rect.height - gap; // cursor on bottom half → popup above

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function hidePopup(): void {
  popup.style.display = "none";
  selectedNodeUrl = null;
}

// =============================================================================
// UI Event Handlers
// =============================================================================
function handleNodeClick(node: NodeData, event: MouseEvent): void {
  // Toggle popup if clicking same node
  if (selectedNodeUrl === node.url) {
    hidePopup();
    return;
  }
  selectedNodeUrl = node.url;
  showPopup(node, event.clientX, event.clientY);
}

// Close popup on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && popup.style.display === "block") {
    hidePopup();
  }
});

// Zoom controls
const ZOOM_FACTOR = 1.5;
zoomInBtn.addEventListener("click", () => {
  const currentZoom = graph.zoom();
  graph.zoom(currentZoom * ZOOM_FACTOR, 200);
});

zoomOutBtn.addEventListener("click", () => {
  const currentZoom = graph.zoom();
  graph.zoom(currentZoom / ZOOM_FACTOR, 200);
});

// =============================================================================
// MCP Apps SDK Integration
// =============================================================================
const app = new App({ name: "Wiki Explorer", version: "1.0.0" });

// Reset button - clears graph and reloads from initial URL
resetBtn.addEventListener("click", async () => {
  if (!initialUrl) return;

  // Fetch fresh data first, then clear and repopulate
  const result = await app.callServerTool({
    name: "get-first-degree-links",
    arguments: { url: initialUrl },
  });

  // Clear current graph and repopulate with result
  graphData.nodes = [];
  graphData.links = [];
  addNode(initialUrl, initialUrl, "default", { x: 0, y: 0 });
  graph.warmupTicks(100);
  handleToolResultData(result);
  graph.centerAt(0, 0, 500);
});

// Open button - opens the Wikipedia page in browser
openBtn.addEventListener("click", async () => {
  if (selectedNodeUrl) {
    await app.openLink({ url: selectedNodeUrl });
    hidePopup();
  }
});

// Expand button - fetches and displays linked pages
expandBtn.addEventListener("click", async () => {
  if (!selectedNodeUrl) return;

  const sourceUrl = selectedNodeUrl;
  expandBtn.setAttribute("disabled", "true");
  expandBtn.textContent = "Loading...";

  try {
    const result = await app.callServerTool({
      name: "get-first-degree-links",
      arguments: { url: sourceUrl },
    });

    graph.warmupTicks(0);
    handleToolResultData(result);
  } catch (e) {
    console.error("Expand error:", e);
    setNodeState(sourceUrl, "error", "Request failed");
    updateGraph();
  } finally {
    expandBtn.removeAttribute("disabled");
    expandBtn.textContent = "Expand";
    hidePopup();
  }
});

// Handle tool input - create initial node with URL as placeholder title
app.ontoolinput = (params) => {
  const args = params.arguments as { url?: string } | undefined;
  if (args?.url) {
    initialUrl = args.url; // Store for reset functionality
    addNode(args.url, args.url, "default", { x: 0, y: 0 });
    graph.warmupTicks(100);
    updateGraph();
    // Center on the new node
    graph.centerAt(0, 0, 500);
  }
};

// Handle tool result - update node and add linked pages (host-initiated, initial load)
app.ontoolresult = (result) => {
  graph.warmupTicks(100);
  handleToolResultData(result);
};

function handleToolResultData(result: CallToolResult): void {
  if (result.isError) {
    console.error("Tool result error:", result);
    return;
  }

  const response = result.structuredContent as unknown as ToolResponse;
  const { page, links, error } = response;

  // Ensure the source node exists
  addNode(page.url, page.title);
  updateNodeTitle(page.url, page.title);

  if (error) {
    setNodeState(page.url, "error", error);
  } else {
    // Get source node position so new nodes appear nearby
    const sourceNode = graphData.nodes.find((n) => n.url === page.url);
    const sourcePos = sourceNode
      ? { x: sourceNode.x ?? 0, y: sourceNode.y ?? 0 }
      : undefined;

    // Add all linked nodes and edges
    for (const link of links) {
      addNode(link.url, link.title, "default", sourcePos);
      addEdge(page.url, link.url);
    }
    setNodeState(page.url, "expanded");
  }

  updateGraph();
}

app.onerror = (err) => {
  console.error("[Wiki Explorer] App error:", err);
};

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.safeAreaInsets) {
    document.body.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    document.body.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    document.body.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    document.body.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

app.onhostcontextchanged = handleHostContextChanged;

// =============================================================================
// Widget Interaction Tools
// =============================================================================

// Tool: Search for a Wikipedia article and navigate to it
app.registerTool(
  "search-article",
  {
    title: "Search Article",
    description:
      "Search for a Wikipedia article and add it to the graph as the new starting point",
    inputSchema: z.object({
      query: z.string().describe("Search query for Wikipedia article"),
    }),
  },
  async (args) => {
    const { query } = args as { query: string };

    // Construct Wikipedia search URL that redirects to the article
    const searchUrl = `https://en.wikipedia.org/wiki/Special:Search?go=Go&search=${encodeURIComponent(query)}`;

    // Use the server tool to fetch the article
    const result = await app.callServerTool({
      name: "get-first-degree-links",
      arguments: { url: searchUrl },
    });

    const response = result.structuredContent as unknown as ToolResponse;
    if (response && response.page) {
      // Clear existing graph and start fresh with this article
      graphData.nodes = [];
      graphData.links = [];
      initialUrl = response.page.url;
      addNode(response.page.url, response.page.title, "default", {
        x: 0,
        y: 0,
      });
      graph.warmupTicks(100);
      handleToolResultData(result);
      graph.centerAt(0, 0, 500);

      return {
        content: [
          {
            type: "text" as const,
            text: `Navigated to article: ${response.page.title}`,
          },
        ],
        structuredContent: {
          success: true,
          article: response.page,
          linksFound: response.links?.length ?? 0,
        },
      };
    }

    return {
      content: [
        { type: "text" as const, text: `Could not find article for: ${query}` },
      ],
      structuredContent: {
        success: false,
        error: "Article not found",
      },
    };
  },
);

// Tool: Get information about the currently displayed article
app.registerTool(
  "get-current-article",
  {
    title: "Get Current Article",
    description:
      "Get information about the currently selected or initial article in the graph",
  },
  async () => {
    const currentUrl = selectedNodeUrl || initialUrl;

    if (!currentUrl) {
      return {
        content: [
          { type: "text" as const, text: "No article is currently selected" },
        ],
        structuredContent: {
          hasSelection: false,
          article: null,
        },
      };
    }

    const node = graphData.nodes.find((n) => n.url === currentUrl);

    if (!node) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Selected article not found in graph",
          },
        ],
        structuredContent: {
          hasSelection: false,
          article: null,
        },
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Current article: ${node.title}\nURL: ${node.url}\nState: ${node.state}`,
        },
      ],
      structuredContent: {
        hasSelection: true,
        article: {
          url: node.url,
          title: node.title,
          state: node.state,
          isExpanded: node.state === "expanded",
          hasError: node.state === "error",
          errorMessage: node.errorMessage,
        },
      },
    };
  },
);

// Tool: Highlight a specific node in the graph
app.registerTool(
  "highlight-node",
  {
    title: "Highlight Node",
    description:
      "Highlight and center on a specific node in the graph by title or URL",
    inputSchema: z.object({
      identifier: z
        .string()
        .describe("The title or URL of the node to highlight"),
    }),
  },
  async (args) => {
    const { identifier } = args as { identifier: string };
    const lowerIdentifier = identifier.toLowerCase();

    // Find node by title (case-insensitive partial match) or exact URL
    const node = graphData.nodes.find(
      (n) =>
        n.url === identifier || n.title.toLowerCase().includes(lowerIdentifier),
    );

    if (!node) {
      return {
        content: [
          { type: "text" as const, text: `Node not found: ${identifier}` },
        ],
        structuredContent: {
          success: false,
          error: "Node not found in graph",
          availableNodes: graphData.nodes.map((n) => n.title),
        },
      };
    }

    // Center on the node and select it
    selectedNodeUrl = node.url;
    if (node.x !== undefined && node.y !== undefined) {
      graph.centerAt(node.x, node.y, 500);
      graph.zoom(2, 500);
    }

    return {
      content: [
        { type: "text" as const, text: `Highlighted node: ${node.title}` },
      ],
      structuredContent: {
        success: true,
        node: {
          url: node.url,
          title: node.title,
          state: node.state,
        },
      },
    };
  },
);

// Tool: Expand a node to show its linked pages
app.registerTool(
  "expand-node",
  {
    title: "Expand Node",
    description:
      "Expand a node to fetch and display all Wikipedia pages it links to. This is the core way to explore the graph.",
    inputSchema: z.object({
      identifier: z.string().describe("The title or URL of the node to expand"),
    }),
  },
  async (args) => {
    const { identifier } = args as { identifier: string };
    const lowerIdentifier = identifier.toLowerCase();

    // Find node by title (case-insensitive partial match) or exact URL
    const node = graphData.nodes.find(
      (n) =>
        n.url === identifier || n.title.toLowerCase().includes(lowerIdentifier),
    );

    if (!node) {
      return {
        content: [
          { type: "text" as const, text: `Node not found: ${identifier}` },
        ],
        structuredContent: {
          success: false,
          error: "Node not found in graph",
          availableNodes: graphData.nodes.map((n) => n.title),
        },
      };
    }

    if (node.state === "expanded") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Node "${node.title}" is already expanded`,
          },
        ],
        structuredContent: {
          success: true,
          alreadyExpanded: true,
          node: { url: node.url, title: node.title },
        },
      };
    }

    if (node.state === "error") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Node "${node.title}" has an error: ${node.errorMessage}`,
          },
        ],
        structuredContent: {
          success: false,
          error: node.errorMessage,
        },
      };
    }

    try {
      // Fetch the linked pages using the server tool
      const result = await app.callServerTool({
        name: "get-first-degree-links",
        arguments: { url: node.url },
      });

      graph.warmupTicks(0);
      handleToolResultData(result);

      const response = result.structuredContent as unknown as ToolResponse;
      const linksAdded = response?.links?.length ?? 0;

      // Center on the expanded node
      if (node.x !== undefined && node.y !== undefined) {
        graph.centerAt(node.x, node.y, 500);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Expanded "${node.title}" - found ${linksAdded} linked articles`,
          },
        ],
        structuredContent: {
          success: true,
          node: { url: node.url, title: node.title },
          linksAdded,
        },
      };
    } catch (e) {
      setNodeState(node.url, "error", "Request failed");
      updateGraph();
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to expand "${node.title}": ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        structuredContent: {
          success: false,
          error: String(e),
        },
      };
    }
  },
);

// Tool: Get list of currently visible nodes in the graph
app.registerTool(
  "get-visible-nodes",
  {
    title: "Get Visible Nodes",
    description: "Get a list of all nodes currently visible in the graph",
  },
  async () => {
    const nodes = graphData.nodes.map((n) => ({
      url: n.url,
      title: n.title,
      state: n.state,
      isExpanded: n.state === "expanded",
      hasError: n.state === "error",
    }));

    const expandedCount = nodes.filter((n) => n.isExpanded).length;
    const errorCount = nodes.filter((n) => n.hasError).length;

    return {
      content: [
        {
          type: "text" as const,
          text: `Graph contains ${nodes.length} nodes:\n${nodes.map((n) => `- ${n.title} (${n.state})`).join("\n")}`,
        },
      ],
      structuredContent: {
        totalNodes: nodes.length,
        expandedNodes: expandedCount,
        errorNodes: errorCount,
        nodes,
      },
    };
  },
);

// Connect to host
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
