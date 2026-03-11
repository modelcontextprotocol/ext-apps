/**
 * CesiumJS Map MCP Server
 *
 * Provides tools for:
 * - geocode: Search for places using OpenStreetMap Nominatim
 * - show-map: Display an interactive 3D globe with annotations (markers, routes, areas, circles)
 * - interact: Navigate, add/update/remove annotations on an existing map view
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { randomUUID } from "crypto";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;
const resourceUri = "ui://cesium-map/mcp-app.html";

// =============================================================================
// Annotation Schemas (discriminated union → oneOf in JSON Schema)
// =============================================================================

const PointCoord = z.object({
  latitude: z.number().describe("Latitude, -90 to 90"),
  longitude: z.number().describe("Longitude, -180 to 180"),
});

/** Optional markdown notes shown in the annotation panel details card. */
const Description = z
  .string()
  .optional()
  .describe("Optional markdown description (shown in the annotation panel)");

const MarkerAnnotation = z.object({
  type: z.literal("marker"),
  id: z.string().describe("Unique annotation id (chosen by caller)"),
  latitude: z.number().describe("Latitude, -90 to 90"),
  longitude: z.number().describe("Longitude, -180 to 180"),
  label: z.string().optional().describe("Text label"),
  description: Description,
  color: z.string().optional().describe('CSS color (default "red")'),
});

const RouteAnnotation = z.object({
  type: z.literal("route"),
  id: z.string().describe("Unique annotation id (chosen by caller)"),
  points: z.array(PointCoord).describe("Ordered waypoints"),
  label: z.string().optional().describe("Text label (shown at midpoint)"),
  description: Description,
  color: z.string().optional().describe('CSS color (default "blue")'),
  width: z.number().optional().describe("Line width in px (default 3)"),
  dashed: z.boolean().optional().describe("Dashed line style"),
});

const AreaAnnotation = z.object({
  type: z.literal("area"),
  id: z.string().describe("Unique annotation id (chosen by caller)"),
  points: z.array(PointCoord).describe("Polygon vertices (min 3, auto-closed)"),
  label: z.string().optional().describe("Text label (shown at centroid)"),
  description: Description,
  color: z.string().optional().describe('Outline CSS color (default "blue")'),
  fillColor: z
    .string()
    .optional()
    .describe('Fill CSS color, e.g. "rgba(255,0,0,0.2)"'),
});

const CircleAnnotation = z.object({
  type: z.literal("circle"),
  id: z.string().describe("Unique annotation id (chosen by caller)"),
  latitude: z.number().describe("Center latitude"),
  longitude: z.number().describe("Center longitude"),
  radiusKm: z.number().describe("Radius in km"),
  label: z.string().optional().describe("Text label (shown at center)"),
  description: Description,
  color: z.string().optional().describe('Outline CSS color (default "blue")'),
  fillColor: z.string().optional().describe("Fill CSS color"),
});

const AnnotationSchema = z.discriminatedUnion("type", [
  MarkerAnnotation,
  RouteAnnotation,
  AreaAnnotation,
  CircleAnnotation,
]);

export type AnnotationDef = z.infer<typeof AnnotationSchema>;

// Update schemas: same discriminator, but type-specific fields are optional
const MarkerAnnotationUpdate = z.object({
  type: z.literal("marker"),
  id: z.string().describe("Annotation id to update"),
  latitude: z.number().optional().describe("New latitude"),
  longitude: z.number().optional().describe("New longitude"),
  label: z.string().optional().describe("New label"),
  description: Description,
  color: z.string().optional().describe("New color"),
});

const RouteAnnotationUpdate = z.object({
  type: z.literal("route"),
  id: z.string().describe("Annotation id to update"),
  points: z.array(PointCoord).optional().describe("Replacement waypoints"),
  label: z.string().optional().describe("New label"),
  description: Description,
  color: z.string().optional().describe("New color"),
  width: z.number().optional().describe("New line width"),
  dashed: z.boolean().optional().describe("New dashed style"),
});

const AreaAnnotationUpdate = z.object({
  type: z.literal("area"),
  id: z.string().describe("Annotation id to update"),
  points: z
    .array(PointCoord)
    .optional()
    .describe("Replacement polygon vertices"),
  label: z.string().optional().describe("New label"),
  description: Description,
  color: z.string().optional().describe("New outline color"),
  fillColor: z.string().optional().describe("New fill color"),
});

const CircleAnnotationUpdate = z.object({
  type: z.literal("circle"),
  id: z.string().describe("Annotation id to update"),
  latitude: z.number().optional().describe("New center latitude"),
  longitude: z.number().optional().describe("New center longitude"),
  radiusKm: z.number().optional().describe("New radius in km"),
  label: z.string().optional().describe("New label"),
  description: Description,
  color: z.string().optional().describe("New outline color"),
  fillColor: z.string().optional().describe("New fill color"),
});

const AnnotationUpdateSchema = z.discriminatedUnion("type", [
  MarkerAnnotationUpdate,
  RouteAnnotationUpdate,
  AreaAnnotationUpdate,
  CircleAnnotationUpdate,
]);

export type AnnotationUpdate = z.infer<typeof AnnotationUpdateSchema>;

// =============================================================================
// Command Queue (shared across stateless server instances)
// =============================================================================

/** Commands expire after this many ms if never polled */
const COMMAND_TTL_MS = 60_000; // 60 seconds

/** Periodic sweep interval to drop stale queues */
const SWEEP_INTERVAL_MS = 30_000; // 30 seconds

/** Fixed batch window: when commands are present, wait this long before returning to let more accumulate */
const POLL_BATCH_WAIT_MS = 200;

export type MapCommand =
  | {
      type: "navigate";
      west: number;
      south: number;
      east: number;
      north: number;
      label?: string;
      fly?: boolean;
    }
  | {
      type: "add";
      annotations: AnnotationDef[];
    }
  | {
      type: "update";
      annotations: AnnotationUpdate[];
    }
  | {
      type: "remove";
      ids: string[];
    };

interface QueueEntry {
  commands: MapCommand[];
  /** Timestamp of the most recent enqueue or dequeue */
  lastActivity: number;
}

const commandQueues = new Map<string, QueueEntry>();

function pruneStaleQueues(): void {
  const now = Date.now();
  for (const [uuid, entry] of commandQueues) {
    if (now - entry.lastActivity > COMMAND_TTL_MS) {
      commandQueues.delete(uuid);
    }
  }
}

// Periodic sweep so abandoned queues don't leak
setInterval(pruneStaleQueues, SWEEP_INTERVAL_MS).unref();

function enqueueCommand(viewUUID: string, command: MapCommand): void {
  let entry = commandQueues.get(viewUUID);
  if (!entry) {
    entry = { commands: [], lastActivity: Date.now() };
    commandQueues.set(viewUUID, entry);
  }
  entry.commands.push(command);
  entry.lastActivity = Date.now();
}

function dequeueCommands(viewUUID: string): MapCommand[] {
  const entry = commandQueues.get(viewUUID);
  if (!entry) return [];
  const commands = entry.commands;
  commandQueues.delete(viewUUID);
  return commands;
}

// Nominatim API response type
interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
  class: string;
  type: string;
  importance: number;
}

// Rate limiting for Nominatim (1 request per second per their usage policy)
let lastNominatimRequest = 0;
const NOMINATIM_RATE_LIMIT_MS = 1100; // 1.1 seconds to be safe

/**
 * Query Nominatim geocoding API with rate limiting
 */
async function geocodeWithNominatim(query: string): Promise<NominatimResult[]> {
  // Respect rate limit
  const now = Date.now();
  const timeSinceLastRequest = now - lastNominatimRequest;
  if (timeSinceLastRequest < NOMINATIM_RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, NOMINATIM_RATE_LIMIT_MS - timeSinceLastRequest),
    );
  }
  lastNominatimRequest = Date.now();

  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "5",
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        "User-Agent":
          "MCP-CesiumMap-Example/1.0 (https://github.com/modelcontextprotocol)",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Nominatim API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<NominatimResult[]>;
}

export interface CreateServerOptions {
  /**
   * When `true`, the `interact` and `poll_map_commands` tools are not registered.
   * Use this for distributed/stateless deployments where the in-memory command
   * queue would not work (e.g. serverless, multi-replica).
   */
  disableInteract?: boolean;
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 * Each HTTP session needs its own server instance because McpServer only supports one transport.
 */
export function createServer(options?: CreateServerOptions): McpServer {
  const server = new McpServer({
    name: "CesiumJS Map Server",
    version: "1.0.0",
  });

  // CSP configuration for external tile sources
  const cspMeta = {
    ui: {
      csp: {
        // Allow fetching tiles from OSM (tiles + geocoding) and Cesium assets
        connectDomains: [
          "https://*.openstreetmap.org", // OSM tiles + Nominatim geocoding
          "https://cesium.com",
          "https://*.cesium.com",
        ],
        // Allow loading tile images, scripts, and Cesium CDN resources
        resourceDomains: [
          "https://*.openstreetmap.org", // OSM map tiles (covers tile.openstreetmap.org)
          "https://cesium.com",
          "https://*.cesium.com",
        ],
      },
      // Clipboard permission for the copy-annotations button
      permissions: { clipboardWrite: {} },
    },
  };

  // Register the CesiumJS map resource with CSP for external tile sources
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          // CSP metadata on the content item takes precedence over listing-level _meta
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: cspMeta,
          },
        ],
      };
    },
  );

  // show-map tool - displays the CesiumJS globe
  registerAppTool(
    server,
    "show-map",
    {
      title: "Show Map",
      description: options?.disableInteract
        ? "Display a world map. Specify the view with either a bounding box (`west`/`south`/`east`/`north`) or a center point (`latitude`/`longitude`) with optional `radiusKm` (default 50). Optionally pass initial `annotations` (markers, routes, areas, circles). For a single location the map already centers there, so a marker is redundant unless you need a label."
        : "Display an interactive world map. Specify the view with either a bounding box (`west`/`south`/`east`/`north`) or a center point (`latitude`/`longitude`) with optional `radiusKm` (default 50). Optionally pass initial `annotations` (markers, routes, areas, circles). For a single location the map already centers there, so a marker is redundant unless you need a label.",
      inputSchema: {
        west: z
          .number()
          .optional()
          .describe("Western longitude (-180 to 180) — bounding box mode"),
        south: z
          .number()
          .optional()
          .describe("Southern latitude (-90 to 90) — bounding box mode"),
        east: z
          .number()
          .optional()
          .describe("Eastern longitude (-180 to 180) — bounding box mode"),
        north: z
          .number()
          .optional()
          .describe("Northern latitude (-90 to 90) — bounding box mode"),
        latitude: z
          .number()
          .optional()
          .default(48.8566)
          .describe("Center latitude (-90 to 90) — center+radius mode"),
        longitude: z
          .number()
          .optional()
          .default(2.3522)
          .describe("Center longitude (-180 to 180) — center+radius mode"),
        radiusKm: z
          .number()
          .optional()
          .default(8)
          .describe("Radius in km around center point (default 50)"),
        label: z
          .string()
          .optional()
          .describe("Optional label to display on the map"),
        annotations: z
          .array(AnnotationSchema)
          .optional()
          .default([
            {
              type: "marker",
              id: "eiffel",
              latitude: 48.8584,
              longitude: 2.2945,
              label: "Eiffel Tower",
              color: "#c0392b",
              description:
                "**Iconic iron lattice tower** built in 1889.\n\n- Height: 330m\n- Visitors: ~7M/year",
            },
            {
              type: "marker",
              id: "louvre",
              latitude: 48.8606,
              longitude: 2.3376,
              label: "Louvre",
              color: "#2980b9",
              description:
                "World's *largest* art museum. See [website](https://www.louvre.fr/en).",
            },
            {
              type: "marker",
              id: "notredame",
              latitude: 48.853,
              longitude: 2.3499,
              label: "Notre-Dame",
              color: "#27ae60",
            },
            {
              type: "route",
              id: "walk",
              label: "Seine walk",
              points: [
                { latitude: 48.8584, longitude: 2.2945 },
                { latitude: 48.8606, longitude: 2.3376 },
                { latitude: 48.853, longitude: 2.3499 },
              ],
              color: "#8e44ad",
              dashed: true,
              description:
                "Scenic `3.5km` riverside walk past three landmarks.",
            },
          ])
          .describe(
            "Initial annotations: markers, routes, areas, or circles to display on the map",
          ),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({
      west,
      south,
      east,
      north,
      latitude,
      longitude,
      radiusKm,
      label,
      annotations,
    }): Promise<CallToolResult> => {
      const uuid = randomUUID();

      // Resolve bounding box: either explicit or computed from center+radius
      let bbox: { west: number; south: number; east: number; north: number };
      if (west != null && south != null && east != null && north != null) {
        bbox = { west, south, east, north };
      } else if (latitude != null && longitude != null) {
        // ~111 km per degree of latitude
        const latDelta = (radiusKm ?? 50) / 111;
        const lonDelta =
          (radiusKm ?? 50) / (111 * Math.cos((latitude * Math.PI) / 180));
        bbox = {
          west: longitude - lonDelta,
          south: latitude - latDelta,
          east: longitude + lonDelta,
          north: latitude + latDelta,
        };
      } else {
        // Default: London area
        bbox = { west: -0.5, south: 51.3, east: 0.3, north: 51.7 };
      }

      const initialAnnotations = annotations ?? [];
      const annotationSummary =
        initialAnnotations.length > 0
          ? ` with ${initialAnnotations.length} annotation(s)`
          : "";

      const interactSuffix = options?.disableInteract
        ? ""
        : ". Use the interact tool with this viewUUID to navigate, add annotations, etc.";

      return {
        content: [
          {
            type: "text",
            text: `Displaying globe (viewUUID: ${uuid}) at: W:${bbox.west.toFixed(4)}, S:${bbox.south.toFixed(4)}, E:${bbox.east.toFixed(4)}, N:${bbox.north.toFixed(4)}${label ? ` (${label})` : ""}${annotationSummary}${interactSuffix}`,
          },
        ],
        _meta: {
          viewUUID: uuid,
          ...(initialAnnotations.length > 0 ? { initialAnnotations } : {}),
          ...(options?.disableInteract ? { interactEnabled: false } : {}),
        },
      };
    },
  );

  if (!options?.disableInteract) {
    // interact tool - send actions to an existing map view
    server.registerTool(
      "interact",
      {
        title: "Interact with Map",
        description: `Send an action to an existing map view. Actions are queued and batched.

Actions:
- navigate: Fly/jump to a bounding box. Requires \`west\`, \`south\`, \`east\`, \`north\`. Optional: \`fly\` (default true), \`label\`.
- add: Add annotations (markers, routes, areas, circles). Requires \`annotations\` array.
- update: Update existing annotations. Requires \`annotations\` array with \`id\` + \`type\` and fields to change.
- remove: Remove annotations by id. Requires \`ids\` array.`,
        inputSchema: {
          viewUUID: z
            .string()
            .describe("The viewUUID of the map (from show-map result)"),
          action: z
            .enum(["navigate", "add", "update", "remove"])
            .describe("Action to perform"),
          // navigate fields
          west: z
            .number()
            .optional()
            .describe("Western longitude, -180 to 180 (for navigate)"),
          south: z
            .number()
            .optional()
            .describe("Southern latitude, -90 to 90 (for navigate)"),
          east: z
            .number()
            .optional()
            .describe("Eastern longitude, -180 to 180 (for navigate)"),
          north: z
            .number()
            .optional()
            .describe("Northern latitude, -90 to 90 (for navigate)"),
          fly: z
            .boolean()
            .optional()
            .default(true)
            .describe("Animate camera flight (for navigate, default true)"),
          label: z.string().optional().describe("Label text (for navigate)"),
          // add annotations
          annotations: z
            .array(AnnotationSchema)
            .optional()
            .describe("Annotations to add (for add action)"),
          // update annotations
          updates: z
            .array(AnnotationUpdateSchema)
            .optional()
            .describe(
              "Annotation updates with id + type + changed fields (for update action)",
            ),
          // remove annotations
          ids: z
            .array(z.string())
            .optional()
            .describe("Annotation ids to remove (for remove action)"),
        },
      },
      async ({
        viewUUID: uuid,
        action,
        west,
        south,
        east,
        north,
        fly,
        label,
        annotations,
        updates,
        ids,
      }): Promise<CallToolResult> => {
        switch (action) {
          case "navigate":
            if (west == null || south == null || east == null || north == null)
              return {
                content: [
                  {
                    type: "text",
                    text: "navigate requires `west`, `south`, `east`, `north`",
                  },
                ],
                isError: true,
              };
            enqueueCommand(uuid, {
              type: "navigate",
              west,
              south,
              east,
              north,
              label,
              fly,
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Queued: navigate to W:${west.toFixed(4)}, S:${south.toFixed(4)}, E:${east.toFixed(4)}, N:${north.toFixed(4)}${label ? ` (${label})` : ""}`,
                },
              ],
            };

          case "add": {
            if (!annotations || annotations.length === 0)
              return {
                content: [
                  {
                    type: "text",
                    text: "add requires a non-empty `annotations` array",
                  },
                ],
                isError: true,
              };
            enqueueCommand(uuid, { type: "add", annotations });
            const types = [...new Set(annotations.map((a) => a.type))].join(
              ", ",
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Added ${annotations.length} annotation(s) (${types})`,
                },
              ],
            };
          }

          case "update": {
            if (!updates || updates.length === 0)
              return {
                content: [
                  {
                    type: "text",
                    text: "update requires a non-empty `updates` array",
                  },
                ],
                isError: true,
              };
            enqueueCommand(uuid, { type: "update", annotations: updates });
            return {
              content: [
                {
                  type: "text",
                  text: `Queued: update ${updates.length} annotation(s)`,
                },
              ],
            };
          }

          case "remove":
            if (!ids || ids.length === 0)
              return {
                content: [
                  {
                    type: "text",
                    text: "remove requires a non-empty `ids` array",
                  },
                ],
                isError: true,
              };
            enqueueCommand(uuid, { type: "remove", ids });
            return {
              content: [
                {
                  type: "text",
                  text: `Queued: remove ${ids.length} annotation(s)`,
                },
              ],
            };

          default:
            return {
              content: [{ type: "text", text: `Unknown action: ${action}` }],
              isError: true,
            };
        }
      },
    );

    // poll_map_commands - app-only tool for polling pending commands
    registerAppTool(
      server,
      "poll_map_commands",
      {
        title: "Poll Map Commands",
        description: "Poll for pending commands for a map view",
        inputSchema: {
          viewUUID: z.string().describe("The viewUUID of the map"),
        },
        _meta: { ui: { visibility: ["app"] } },
      },
      async ({ viewUUID: uuid }): Promise<CallToolResult> => {
        // If commands are queued, wait a fixed window to let more accumulate
        if (commandQueues.has(uuid)) {
          await new Promise((r) => setTimeout(r, POLL_BATCH_WAIT_MS));
        }
        const commands = dequeueCommands(uuid);
        return {
          content: [{ type: "text", text: `${commands.length} command(s)` }],
          structuredContent: { commands },
        };
      },
    );
  } // end if (!disableInteract)

  // geocode tool - searches for places using Nominatim (no UI)
  server.registerTool(
    "geocode",
    {
      title: "Geocode",
      description:
        "Search for places using OpenStreetMap. Accepts one or more queries. Returns coordinates and bounding boxes (top result per query).",
      inputSchema: {
        queries: z
          .array(z.string())
          .describe(
            "Place names or addresses to search for (e.g., ['Paris', 'Golden Gate Bridge'])",
          ),
      },
    },
    async ({ queries }): Promise<CallToolResult> => {
      const sections: string[] = [];
      let hasError = false;

      for (const query of queries) {
        try {
          const results = await geocodeWithNominatim(query);
          if (results.length === 0) {
            sections.push(`## ${query}\nNo results found.`);
            continue;
          }
          const formatted = results.map((r) => ({
            displayName: r.display_name,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            boundingBox: {
              south: parseFloat(r.boundingbox[0]),
              north: parseFloat(r.boundingbox[1]),
              west: parseFloat(r.boundingbox[2]),
              east: parseFloat(r.boundingbox[3]),
            },
            type: r.type,
            importance: r.importance,
          }));
          const lines = formatted.map(
            (r, i) =>
              `${i + 1}. ${r.displayName}\n   Coordinates: ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}\n   Bounding box: W:${r.boundingBox.west.toFixed(4)}, S:${r.boundingBox.south.toFixed(4)}, E:${r.boundingBox.east.toFixed(4)}, N:${r.boundingBox.north.toFixed(4)}`,
          );
          sections.push(`## ${query}\n${lines.join("\n\n")}`);
        } catch (error) {
          hasError = true;
          sections.push(
            `## ${query}\nError: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return {
        content: [{ type: "text", text: sections.join("\n\n") }],
        isError: hasError ? true : undefined,
      };
    },
  );

  return server;
}
