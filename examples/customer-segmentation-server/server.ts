import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RESOURCE_URI_META_KEY } from "../../dist/src/app";
import {
  generateCustomers,
  generateSegmentSummaries,
} from "./src/data-generator.ts";
import { SEGMENTS, type Customer, type SegmentSummary } from "./src/types.ts";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const DIST_DIR = path.join(import.meta.dirname, "dist");

// Schemas - types are derived from these using z.infer
const GetCustomerDataInputSchema = z.object({
  segment: z
    .enum(["All", ...SEGMENTS])
    .optional()
    .describe("Filter by segment (default: All)"),
});

// Cache generated data for session consistency
let cachedCustomers: Customer[] | null = null;
let cachedSegments: SegmentSummary[] | null = null;

function getCustomerData(segmentFilter?: string): {
  customers: Customer[];
  segments: SegmentSummary[];
} {
  // Generate data on first call
  if (!cachedCustomers) {
    cachedCustomers = generateCustomers(250);
    cachedSegments = generateSegmentSummaries(cachedCustomers);
  }

  // Filter by segment if specified
  let customers = cachedCustomers;
  if (segmentFilter && segmentFilter !== "All") {
    customers = cachedCustomers.filter((c) => c.segment === segmentFilter);
  }

  return {
    customers,
    segments: cachedSegments!,
  };
}

const server = new McpServer({
  name: "Customer Segmentation Server",
  version: "1.0.0",
});

// Register the get-customer-data tool and its associated UI resource
{
  const resourceUri = "ui://customer-segmentation/mcp-app.html";

  server.registerTool(
    "get-customer-data",
    {
      title: "Get Customer Data",
      description:
        "Returns customer data with segment information for visualization. Optionally filter by segment.",
      inputSchema: GetCustomerDataInputSchema.shape,
      _meta: { [RESOURCE_URI_META_KEY]: resourceUri },
    },
    async ({ segment }): Promise<CallToolResult> => {
      const data = getCustomerData(segment);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );

  server.registerResource(
    resourceUri,
    resourceUri,
    { description: "Customer Segmentation Explorer UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: "text/html;profile=mcp-app",
            text: html,
          },
        ],
      };
    },
  );
}

async function main() {
  if (process.argv.includes("--stdio")) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Customer Segmentation Server running in stdio mode");
  } else {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.post("/mcp", async (req: Request, res: Response) => {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on("close", () => {
          transport.close();
        });

        await server.connect(transport);

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    const httpServer = app.listen(PORT, (err) => {
      if (err) {
        console.error("Error starting server:", err);
        process.exit(1);
      }
      console.log(
        `Customer Segmentation Server listening on http://localhost:${PORT}/mcp`,
      );
    });

    function shutdown() {
      console.log("\nShutting down...");
      httpServer.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

main().catch(console.error);
