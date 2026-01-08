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

const ChartTypeSchema = z.enum(["bar", "line", "area", "pie"]);

const GetChartDataInputSchema = z.object({
  datasetId: z
    .enum(["monthly-revenue", "quarterly-sales", "product-mix"])
    .describe("Which dataset to load"),
  chartType: ChartTypeSchema.optional().describe(
    "Preferred chart type (bar, line, area, pie)",
  ),
});

// Types
type ChartType = z.infer<typeof ChartTypeSchema>;

interface DataPoint {
  [key: string]: string | number;
}

interface ChartMetadata {
  title: string;
  description: string;
  xKey: string;
  series: string[];
  colors: Record<string, string>;
  defaultChartType: ChartType;
  supportedChartTypes: ChartType[];
}

interface ChartDataset {
  data: DataPoint[];
  metadata: ChartMetadata;
}

// ============================================================================
// Sample Datasets
// ============================================================================

const DATASETS: Record<string, ChartDataset> = {
  "monthly-revenue": {
    data: [
      { month: "Jan", revenue: 42000, costs: 28000, profit: 14000 },
      { month: "Feb", revenue: 38000, costs: 25000, profit: 13000 },
      { month: "Mar", revenue: 45000, costs: 29000, profit: 16000 },
      { month: "Apr", revenue: 52000, costs: 32000, profit: 20000 },
      { month: "May", revenue: 48000, costs: 30000, profit: 18000 },
      { month: "Jun", revenue: 56000, costs: 35000, profit: 21000 },
      { month: "Jul", revenue: 61000, costs: 38000, profit: 23000 },
      { month: "Aug", revenue: 58000, costs: 36000, profit: 22000 },
      { month: "Sep", revenue: 64000, costs: 40000, profit: 24000 },
      { month: "Oct", revenue: 70000, costs: 43000, profit: 27000 },
      { month: "Nov", revenue: 75000, costs: 46000, profit: 29000 },
      { month: "Dec", revenue: 82000, costs: 50000, profit: 32000 },
    ],
    metadata: {
      title: "Monthly Revenue",
      description: "Revenue, costs, and profit over the past 12 months",
      xKey: "month",
      series: ["revenue", "costs", "profit"],
      colors: {
        revenue: "#3b82f6",
        costs: "#ef4444",
        profit: "#10b981",
      },
      defaultChartType: "bar",
      supportedChartTypes: ["bar", "line", "area"],
    },
  },
  "quarterly-sales": {
    data: [
      {
        quarter: "Q1 2023",
        north: 120000,
        south: 85000,
        east: 95000,
        west: 110000,
      },
      {
        quarter: "Q2 2023",
        north: 135000,
        south: 92000,
        east: 105000,
        west: 125000,
      },
      {
        quarter: "Q3 2023",
        north: 142000,
        south: 98000,
        east: 112000,
        west: 138000,
      },
      {
        quarter: "Q4 2023",
        north: 168000,
        south: 115000,
        east: 128000,
        west: 155000,
      },
      {
        quarter: "Q1 2024",
        north: 155000,
        south: 108000,
        east: 118000,
        west: 145000,
      },
      {
        quarter: "Q2 2024",
        north: 178000,
        south: 125000,
        east: 135000,
        west: 165000,
      },
    ],
    metadata: {
      title: "Quarterly Sales by Region",
      description: "Sales performance across different regions",
      xKey: "quarter",
      series: ["north", "south", "east", "west"],
      colors: {
        north: "#6366f1",
        south: "#f59e0b",
        east: "#14b8a6",
        west: "#ec4899",
      },
      defaultChartType: "bar",
      supportedChartTypes: ["bar", "line", "area"],
    },
  },
  "product-mix": {
    data: [
      { name: "Enterprise", value: 42, color: "#3b82f6" },
      { name: "Professional", value: 28, color: "#8b5cf6" },
      { name: "Starter", value: 18, color: "#10b981" },
      { name: "Free", value: 8, color: "#f59e0b" },
      { name: "Legacy", value: 4, color: "#64748b" },
    ],
    metadata: {
      title: "Product Mix",
      description: "Revenue distribution across product tiers",
      xKey: "name",
      series: ["value"],
      colors: {
        Enterprise: "#3b82f6",
        Professional: "#8b5cf6",
        Starter: "#10b981",
        Free: "#f59e0b",
        Legacy: "#64748b",
      },
      defaultChartType: "pie",
      supportedChartTypes: ["pie", "bar"],
    },
  },
};

// ============================================================================
// MCP Server
// ============================================================================

function createServer(): McpServer {
  const server = new McpServer({
    name: "Recharts Dashboard Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://recharts-dashboard/mcp-app.html";

  registerAppTool(
    server,
    "get-chart-data",
    {
      title: "Get Chart Data",
      description:
        "Returns chart data for visualization. Supports multiple datasets and chart types.",
      inputSchema: GetChartDataInputSchema.shape,
      _meta: { [RESOURCE_URI_META_KEY]: resourceUri },
    },
    async (args: {
      datasetId: "monthly-revenue" | "quarterly-sales" | "product-mix";
      chartType?: ChartType;
    }): Promise<CallToolResult> => {
      const dataset = DATASETS[args.datasetId];

      if (!dataset) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Unknown dataset: ${args.datasetId}` },
          ],
        };
      }

      // Validate chart type if provided
      const chartType = args.chartType ?? dataset.metadata.defaultChartType;
      if (!dataset.metadata.supportedChartTypes.includes(chartType)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Chart type "${chartType}" not supported for this dataset. Supported: ${dataset.metadata.supportedChartTypes.join(", ")}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              datasetId: args.datasetId,
              chartType,
              data: dataset.data,
              metadata: dataset.metadata,
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
    { mimeType: RESOURCE_MIME_TYPE, description: "Recharts Dashboard UI" },
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
