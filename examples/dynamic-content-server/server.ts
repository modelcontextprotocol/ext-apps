/**
 * @file MCP server demonstrating Dynamic View Content.
 *
 * The predeclared `ui://` resource is a generic renderer: it declares (via
 * `contentMimeTypes`) that it renders `application/vnd.example.dynamic-ui+json`
 * payloads. Tools don't bake data into the template — they return declarative
 * UI documents as embedded resources marked with `_meta.ui.content`, which the
 * host forwards to the view. Button clicks in the view come back as
 * `tools/call` requests to an app-visibility tool, whose response carries new
 * payloads — closing the interactive loop.
 */
import {
  createViewContentBlock,
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DYNAMIC_UI_MIME_TYPE, type UiSurface } from "./dynamic-ui.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const RESOURCE_URI = "ui://dynamic-content-server/renderer.html";

type Flight = {
  id: string;
  airline: string;
  departure: string;
  arrival: string;
  price: number;
};

const FLIGHTS: Flight[] = [
  {
    id: "UA954",
    airline: "United",
    departure: "08:10",
    arrival: "12:35",
    price: 1240,
  },
  {
    id: "LY007",
    airline: "El Al",
    departure: "10:45",
    arrival: "15:20",
    price: 1180,
  },
  {
    id: "DL221",
    airline: "Delta",
    departure: "16:30",
    arrival: "21:05",
    price: 990,
  },
];

/** Build the flight results surface — the server generates UI at call time. */
function flightResultsSurface(destination: string): UiSurface {
  return {
    surface: [
      { kind: "text", variant: "title", text: `Flights to ${destination}` },
      {
        kind: "column",
        children: FLIGHTS.map((flight) => ({
          kind: "card" as const,
          children: [
            {
              kind: "row" as const,
              children: [
                {
                  kind: "text" as const,
                  text: `${flight.airline} ${flight.id}`,
                },
                {
                  kind: "text" as const,
                  variant: "note" as const,
                  text: `${flight.departure} → ${flight.arrival}`,
                },
                { kind: "text" as const, text: `$${flight.price}` },
                {
                  kind: "button" as const,
                  label: "Select",
                  // The renderer's event bridge turns this into a tools/call
                  action: {
                    tool: "select-flight",
                    arguments: { flightId: flight.id },
                  },
                },
              ],
            },
          ],
        })),
      },
      { kind: "text", variant: "note", text: "Prices include taxes and fees." },
    ],
  };
}

/** Build the confirmation surface returned by the app-visibility tool. */
function confirmationSurface(flight: Flight): UiSurface {
  return {
    surface: [
      { kind: "text", variant: "title", text: "Flight selected" },
      {
        kind: "card",
        children: [
          {
            kind: "text",
            text: `${flight.airline} ${flight.id}, departs ${flight.departure}`,
          },
          { kind: "text", text: `Total: $${flight.price}` },
          {
            kind: "text",
            variant: "note",
            text: "This is a demo — nothing was booked.",
          },
        ],
      },
      {
        kind: "button",
        label: "Back to results",
        action: {
          tool: "search-flights",
          arguments: { destination: "San Francisco" },
        },
      },
    ],
  };
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Dynamic View Content Example Server",
    version: "1.0.0",
  });

  // Model-visible tool: returns a text fallback for model context plus a
  // marked dynamic content payload for the renderer view.
  //
  // Production servers should gate this registration on the host's negotiated
  // `contentMimeTypes` extension setting — see `getUiCapability` and
  // `supportsContentMimeType` — and degrade to a text-only variant otherwise.
  registerAppTool(
    server,
    "search-flights",
    {
      title: "Search Flights",
      description:
        "Search for flights to a destination and present the options.",
      inputSchema: {
        destination: z
          .string()
          .describe("Destination city")
          .default("San Francisco"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ destination }): Promise<CallToolResult> => {
      const cheapest = FLIGHTS.reduce((a, b) => (a.price <= b.price ? a : b));
      return {
        content: [
          // Text fallback: model context and text-only hosts
          {
            type: "text",
            text: `Found ${FLIGHTS.length} flights to ${destination}. Cheapest: ${cheapest.airline} ${cheapest.id} at $${cheapest.price}.`,
          },
          // Dynamic content payload: forwarded to the renderer view,
          // excluded from model context
          createViewContentBlock({
            uri: `dynamic-ui://dynamic-content-server/surfaces/${encodeURIComponent(destination)}`,
            mimeType: DYNAMIC_UI_MIME_TYPE,
            text: JSON.stringify(flightResultsSurface(destination)),
          }),
        ],
      };
    },
  );

  // App-visibility tool: hidden from the model, called by the renderer's
  // event bridge. Its response carries the next payload in the loop.
  registerAppTool(
    server,
    "select-flight",
    {
      title: "Select Flight",
      description: "Select a flight from previously presented options.",
      inputSchema: {
        flightId: z.string().describe("Flight id from the presented options"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async ({ flightId }): Promise<CallToolResult> => {
      const flight = FLIGHTS.find((f) => f.id === flightId);
      if (!flight) {
        return {
          content: [{ type: "text", text: `Unknown flight: ${flightId}` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `Selected ${flight.airline} ${flight.id} ($${flight.price}).`,
          },
          createViewContentBlock({
            uri: `dynamic-ui://dynamic-content-server/surfaces/confirmation-${flight.id}`,
            mimeType: DYNAMIC_UI_MIME_TYPE,
            text: JSON.stringify(confirmationSurface(flight)),
          }),
        ],
      };
    },
  );

  // The renderer resource: predeclared, prefetchable, reviewable. It declares
  // the payload MIME types it renders via `contentMimeTypes`.
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          contentMimeTypes: [DYNAMIC_UI_MIME_TYPE],
          prefersBorder: true,
        },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                contentMimeTypes: [DYNAMIC_UI_MIME_TYPE],
                prefersBorder: true,
              },
            },
          },
        ],
      };
    },
  );

  return server;
}
