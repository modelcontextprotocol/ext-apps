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
import { A2UI_MIME_TYPE } from "./dynamic-ui.js";

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
function flightResultsSurface(destination: string): any[] {
  return [
    {
      surfaceUpdate: {
        surfaceId: "flights-surface",
        components: [
          {
            id: "root",
            component: {
              Card: {
                child: "main-column",
              },
            },
          },
          {
            id: "main-column",
            component: {
              Column: {
                children: {
                  explicitList: ["title", "flights-list", "note"],
                },
              },
            },
          },
          {
            id: "title",
            component: {
              Text: {
                text: { literalString: `Flights to ${destination}` },
                usageHint: "h1",
              },
            },
          },
          {
            id: "note",
            component: {
              Text: {
                text: { literalString: "Prices include taxes and fees." },
                usageHint: "caption",
              },
            },
          },
          {
            id: "flights-list",
            component: {
              Column: {
                children: {
                  explicitList: FLIGHTS.map((f) => `flight-card-${f.id}`),
                },
              },
            },
          },
          ...FLIGHTS.flatMap((flight) => [
            {
              id: `flight-card-${flight.id}`,
              component: {
                Card: { child: `flight-row-${flight.id}` },
              },
            },
            {
              id: `flight-row-${flight.id}`,
              component: {
                Row: {
                  children: {
                    explicitList: [
                      `flight-airline-${flight.id}`,
                      `flight-time-${flight.id}`,
                      `flight-price-${flight.id}`,
                      `flight-btn-${flight.id}`,
                    ],
                  },
                },
              },
            },
            {
              id: `flight-airline-${flight.id}`,
              component: {
                Text: {
                  text: { literalString: `${flight.airline} ${flight.id}` },
                },
              },
            },
            {
              id: `flight-time-${flight.id}`,
              component: {
                Text: {
                  text: {
                    literalString: `${flight.departure} → ${flight.arrival}`,
                  },
                  usageHint: "body",
                },
              },
            },
            {
              id: `flight-price-${flight.id}`,
              component: {
                Text: { text: { literalString: `$${flight.price}` } },
              },
            },
            {
              id: `flight-btn-${flight.id}`,
              component: {
                Button: {
                  child: `flight-btn-text-${flight.id}`,
                  action: {
                    name: "select-flight",
                    context: [
                      { key: "flightId", value: { literalString: flight.id } },
                    ],
                  },
                },
              },
            },
            {
              id: `flight-btn-text-${flight.id}`,
              component: { Text: { text: { literalString: "Select" } } },
            },
          ]),
        ],
      },
    },
    {
      beginRendering: {
        surfaceId: "flights-surface",
        root: "root",
      },
    },
  ];
}

/** Build the confirmation surface returned by the app-visibility tool. */
function confirmationSurface(flight: Flight): any[] {
  return [
    {
      surfaceUpdate: {
        surfaceId: "flights-surface",
        components: [
          {
            id: "root",
            component: {
              Card: {
                child: "main-column",
              },
            },
          },
          {
            id: "main-column",
            component: {
              Column: {
                children: {
                  explicitList: ["title", "card", "back-btn"],
                },
              },
            },
          },
          {
            id: "title",
            component: {
              Text: {
                text: { literalString: "Flight selected" },
                usageHint: "h1",
              },
            },
          },
          {
            id: "card",
            component: {
              Card: { child: "card-col" },
            },
          },
          {
            id: "card-col",
            component: {
              Column: {
                children: {
                  explicitList: ["text1", "text2", "text3"],
                },
              },
            },
          },
          {
            id: "text1",
            component: {
              Text: {
                text: {
                  literalString: `${flight.airline} ${flight.id}, departs ${flight.departure}`,
                },
              },
            },
          },
          {
            id: "text2",
            component: {
              Text: { text: { literalString: `Total: $${flight.price}` } },
            },
          },
          {
            id: "text3",
            component: {
              Text: {
                text: { literalString: "This is a demo — nothing was booked." },
                usageHint: "caption",
              },
            },
          },
          {
            id: "back-btn",
            component: {
              Button: {
                child: "back-btn-text",
                action: {
                  name: "search-flights",
                  context: [
                    {
                      key: "destination",
                      value: { literalString: "San Francisco" },
                    },
                  ],
                },
              },
            },
          },
          {
            id: "back-btn-text",
            component: { Text: { text: { literalString: "Back to results" } } },
          },
        ],
      },
    },
    {
      beginRendering: {
        surfaceId: "flights-surface",
        root: "root",
      },
    },
  ];
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
            mimeType: A2UI_MIME_TYPE,
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
            mimeType: A2UI_MIME_TYPE,
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
          contentMimeTypes: [A2UI_MIME_TYPE],
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
                contentMimeTypes: [A2UI_MIME_TYPE],
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
