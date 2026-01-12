import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { startServer } from "./src/server-utils.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");

// ============================================================================
// Schemas
// ============================================================================

const GraphNodeSchema = z.object({
  id: z.string(),
  group: z.string(),
  size: z.number(),
  description: z.string().optional(),
});

const GraphLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  strength: z.number().min(0).max(1),
});

const GraphDataSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  links: z.array(GraphLinkSchema),
  metadata: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

const GetGraphDataInputSchema = z.object({
  graphId: z
    .enum(["dependencies", "org-chart", "knowledge"])
    .optional()
    .describe("Which graph dataset to load"),
  centerNode: z.string().optional().describe("Node ID to center the view on"),
  depth: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe("Depth of nodes to include from center (1-5)"),
});

// Types
type GraphData = z.infer<typeof GraphDataSchema>;

// ============================================================================
// Sample Graph Data
// ============================================================================

const SAMPLE_GRAPHS: Record<string, GraphData> = {
  dependencies: {
    nodes: [
      {
        id: "react",
        group: "core",
        size: 40,
        description: "React library for building UIs",
      },
      {
        id: "react-dom",
        group: "core",
        size: 30,
        description: "React DOM renderer",
      },
      {
        id: "recharts",
        group: "viz",
        size: 25,
        description: "Charting library for React",
      },
      {
        id: "d3",
        group: "viz",
        size: 35,
        description: "Data visualization library",
      },
      {
        id: "typescript",
        group: "tooling",
        size: 30,
        description: "TypeScript compiler",
      },
      {
        id: "vite",
        group: "tooling",
        size: 28,
        description: "Next-generation frontend build tool",
      },
      {
        id: "eslint",
        group: "tooling",
        size: 22,
        description: "JavaScript linter",
      },
      {
        id: "prettier",
        group: "tooling",
        size: 20,
        description: "Code formatter",
      },
      {
        id: "zod",
        group: "runtime",
        size: 18,
        description: "TypeScript-first schema validation",
      },
      {
        id: "express",
        group: "runtime",
        size: 26,
        description: "Web framework for Node.js",
      },
      { id: "lodash", group: "util", size: 24, description: "Utility library" },
      { id: "axios", group: "util", size: 20, description: "HTTP client" },
      {
        id: "dayjs",
        group: "util",
        size: 16,
        description: "Date utility library",
      },
      {
        id: "tailwindcss",
        group: "styling",
        size: 28,
        description: "Utility-first CSS framework",
      },
      {
        id: "postcss",
        group: "styling",
        size: 18,
        description: "CSS transformer",
      },
    ],
    links: [
      { source: "react-dom", target: "react", strength: 1.0 },
      { source: "recharts", target: "react", strength: 0.9 },
      { source: "recharts", target: "d3", strength: 0.7 },
      { source: "vite", target: "typescript", strength: 0.6 },
      { source: "eslint", target: "typescript", strength: 0.5 },
      { source: "prettier", target: "eslint", strength: 0.4 },
      { source: "axios", target: "lodash", strength: 0.3 },
      { source: "tailwindcss", target: "postcss", strength: 0.8 },
      { source: "zod", target: "typescript", strength: 0.6 },
      { source: "express", target: "zod", strength: 0.4 },
      { source: "vite", target: "postcss", strength: 0.5 },
      { source: "recharts", target: "lodash", strength: 0.3 },
    ],
    metadata: {
      title: "Package Dependencies",
      description: "Common npm package relationships in a modern web project",
    },
  },
  "org-chart": {
    nodes: [
      {
        id: "ceo",
        group: "executive",
        size: 45,
        description: "Chief Executive Officer",
      },
      {
        id: "cto",
        group: "executive",
        size: 38,
        description: "Chief Technology Officer",
      },
      {
        id: "cfo",
        group: "executive",
        size: 38,
        description: "Chief Financial Officer",
      },
      {
        id: "vp-eng",
        group: "management",
        size: 32,
        description: "VP of Engineering",
      },
      {
        id: "vp-product",
        group: "management",
        size: 32,
        description: "VP of Product",
      },
      {
        id: "vp-sales",
        group: "management",
        size: 32,
        description: "VP of Sales",
      },
      {
        id: "eng-lead-1",
        group: "lead",
        size: 26,
        description: "Engineering Lead - Platform",
      },
      {
        id: "eng-lead-2",
        group: "lead",
        size: 26,
        description: "Engineering Lead - Frontend",
      },
      {
        id: "pm-1",
        group: "lead",
        size: 24,
        description: "Product Manager - Core",
      },
      {
        id: "pm-2",
        group: "lead",
        size: 24,
        description: "Product Manager - Growth",
      },
      { id: "dev-1", group: "ic", size: 18, description: "Senior Developer" },
      { id: "dev-2", group: "ic", size: 18, description: "Developer" },
      { id: "dev-3", group: "ic", size: 18, description: "Developer" },
      { id: "designer", group: "ic", size: 20, description: "UX Designer" },
    ],
    links: [
      { source: "cto", target: "ceo", strength: 1.0 },
      { source: "cfo", target: "ceo", strength: 1.0 },
      { source: "vp-eng", target: "cto", strength: 0.9 },
      { source: "vp-product", target: "cto", strength: 0.9 },
      { source: "vp-sales", target: "cfo", strength: 0.8 },
      { source: "eng-lead-1", target: "vp-eng", strength: 0.8 },
      { source: "eng-lead-2", target: "vp-eng", strength: 0.8 },
      { source: "pm-1", target: "vp-product", strength: 0.8 },
      { source: "pm-2", target: "vp-product", strength: 0.8 },
      { source: "dev-1", target: "eng-lead-1", strength: 0.7 },
      { source: "dev-2", target: "eng-lead-2", strength: 0.7 },
      { source: "dev-3", target: "eng-lead-2", strength: 0.7 },
      { source: "designer", target: "pm-1", strength: 0.6 },
      { source: "designer", target: "eng-lead-2", strength: 0.4 },
    ],
    metadata: {
      title: "Organization Chart",
      description:
        "Company organizational structure and reporting relationships",
    },
  },
  knowledge: {
    nodes: [
      { id: "ml", group: "ai", size: 40, description: "Machine Learning" },
      {
        id: "deep-learning",
        group: "ai",
        size: 35,
        description: "Deep Learning",
      },
      {
        id: "nlp",
        group: "ai",
        size: 30,
        description: "Natural Language Processing",
      },
      { id: "cv", group: "ai", size: 28, description: "Computer Vision" },
      {
        id: "transformers",
        group: "architecture",
        size: 32,
        description: "Transformer architecture",
      },
      {
        id: "cnn",
        group: "architecture",
        size: 26,
        description: "Convolutional Neural Networks",
      },
      {
        id: "rnn",
        group: "architecture",
        size: 22,
        description: "Recurrent Neural Networks",
      },
      {
        id: "python",
        group: "tools",
        size: 38,
        description: "Python programming language",
      },
      {
        id: "pytorch",
        group: "tools",
        size: 30,
        description: "PyTorch framework",
      },
      {
        id: "tensorflow",
        group: "tools",
        size: 28,
        description: "TensorFlow framework",
      },
      {
        id: "huggingface",
        group: "tools",
        size: 26,
        description: "Hugging Face library",
      },
      {
        id: "llm",
        group: "application",
        size: 35,
        description: "Large Language Models",
      },
      { id: "chatgpt", group: "application", size: 30, description: "ChatGPT" },
      {
        id: "stable-diffusion",
        group: "application",
        size: 28,
        description: "Stable Diffusion",
      },
    ],
    links: [
      { source: "deep-learning", target: "ml", strength: 1.0 },
      { source: "nlp", target: "ml", strength: 0.9 },
      { source: "cv", target: "ml", strength: 0.9 },
      { source: "transformers", target: "deep-learning", strength: 0.8 },
      { source: "cnn", target: "deep-learning", strength: 0.8 },
      { source: "rnn", target: "deep-learning", strength: 0.7 },
      { source: "transformers", target: "nlp", strength: 0.9 },
      { source: "cnn", target: "cv", strength: 0.9 },
      { source: "pytorch", target: "python", strength: 0.8 },
      { source: "tensorflow", target: "python", strength: 0.8 },
      { source: "huggingface", target: "transformers", strength: 0.9 },
      { source: "huggingface", target: "pytorch", strength: 0.7 },
      { source: "llm", target: "transformers", strength: 1.0 },
      { source: "llm", target: "nlp", strength: 0.9 },
      { source: "chatgpt", target: "llm", strength: 1.0 },
      { source: "stable-diffusion", target: "cv", strength: 0.8 },
      { source: "stable-diffusion", target: "deep-learning", strength: 0.7 },
    ],
    metadata: {
      title: "AI/ML Knowledge Graph",
      description:
        "Concepts and relationships in artificial intelligence and machine learning",
    },
  },
};

// ============================================================================
// Graph Filtering
// ============================================================================

function filterGraphByCenter(
  graph: GraphData,
  centerNode: string,
  depth: number,
): GraphData {
  // Find all nodes within `depth` hops from centerNode
  const nodeSet = new Set<string>([centerNode]);
  const linkSet = new Map<string, Set<string>>();

  // Build adjacency map
  for (const link of graph.links) {
    if (!linkSet.has(link.source)) linkSet.set(link.source, new Set());
    if (!linkSet.has(link.target)) linkSet.set(link.target, new Set());
    linkSet.get(link.source)!.add(link.target);
    linkSet.get(link.target)!.add(link.source);
  }

  // BFS to find nodes within depth
  let frontier = [centerNode];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      const neighbors = linkSet.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (!nodeSet.has(neighbor)) {
          nodeSet.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  // Filter nodes and links
  const filteredNodes = graph.nodes.filter((n) => nodeSet.has(n.id));
  const filteredLinks = graph.links.filter(
    (l) => nodeSet.has(l.source) && nodeSet.has(l.target),
  );

  return {
    nodes: filteredNodes,
    links: filteredLinks,
    metadata: {
      ...graph.metadata,
      title: `${graph.metadata.title} (centered on ${centerNode})`,
    },
  };
}

// ============================================================================
// MCP Server
// ============================================================================

function createServer(): McpServer {
  const server = new McpServer({
    name: "D3 Graph Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://d3-graph/mcp-app.html";

  registerAppTool(
    server,
    "get-graph-data",
    {
      title: "Get Graph Data",
      description:
        "Returns graph data (nodes and links) for force-directed visualization. Supports multiple graph datasets and optional filtering by center node.",
      inputSchema: GetGraphDataInputSchema.shape,
      _meta: { [RESOURCE_URI_META_KEY]: resourceUri },
    },
    async (args: {
      graphId?: "dependencies" | "org-chart" | "knowledge";
      centerNode?: string;
      depth?: number;
    }): Promise<CallToolResult> => {
      const graphId = args.graphId ?? "dependencies";
      let graphData = SAMPLE_GRAPHS[graphId];

      if (!graphData) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown graph: ${graphId}` }],
        };
      }

      // Filter if centerNode is specified
      if (args.centerNode) {
        const nodeExists = graphData.nodes.some(
          (n) => n.id === args.centerNode,
        );
        if (!nodeExists) {
          return {
            isError: true,
            content: [
              { type: "text", text: `Node not found: ${args.centerNode}` },
            ],
          };
        }
        graphData = filterGraphByCenter(
          graphData,
          args.centerNode,
          args.depth ?? 2,
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              graphId,
              ...graphData,
            }),
          },
        ],
      };
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE, description: "D3 Graph Explorer UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );

  return server;
}

startServer(createServer);
