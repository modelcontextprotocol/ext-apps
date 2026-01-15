/**
 * MCP Server for managing virtual desktops using LinuxServer webtop containers.
 *
 * Tools:
 * - ListDesktops: List all virtual desktop containers
 * - CreateDesktop: Create a new virtual desktop
 * - ViewDesktop: View a virtual desktop (has MCP App UI)
 * - ShutdownDesktop: Stop and remove a virtual desktop
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { startServer } from "./server-utils.js";
import {
  listDesktops,
  createDesktop,
  getDesktop,
  shutdownDesktop,
  checkDocker,
  getPortConfig,
  waitForVncReady,
  CONTAINER_PREFIX,
  DESKTOP_VARIANTS,
  DEFAULT_VARIANT,
  DEFAULT_RESOLUTION,
  VIRTUAL_DESKTOPS_DIR,
  type DesktopInfo,
  type DesktopVariant,
} from "./src/docker.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");

// ============================================================================
// Schemas
// ============================================================================

const ResolutionSchema = z.object({
  width: z.number().min(640).max(3840).describe("Width in pixels"),
  height: z.number().min(480).max(2160).describe("Height in pixels"),
});

const MountSchema = z.object({
  hostPath: z.string().describe("Path on the host machine"),
  containerPath: z.string().describe("Path inside the container"),
  readonly: z.boolean().optional().describe("Mount as read-only"),
});

const DEFAULT_DESKTOP_NAME = "my-desktop";

const CreateDesktopInputSchema = z.object({
  name: z
    .string()
    .default(DEFAULT_DESKTOP_NAME)
    .describe(
      `Name for the desktop (will be sanitized and prefixed with '${CONTAINER_PREFIX}')`,
    ),
  variant: z
    .enum(DESKTOP_VARIANTS)
    .default(DEFAULT_VARIANT)
    .describe(
      `Desktop variant. Options: xfce (lightweight), webtop-ubuntu-xfce, webtop-alpine-xfce`,
    ),
  resolution: ResolutionSchema.optional().describe(
    `Initial resolution (default: ${DEFAULT_RESOLUTION.width}x${DEFAULT_RESOLUTION.height})`,
  ),
  commands: z
    .array(z.string())
    .optional()
    .describe("Commands to run on startup"),
  mounts: z.array(MountSchema).optional().describe("Additional volume mounts"),
});

const ViewDesktopInputSchema = z.object({
  name: z
    .string()
    .default(DEFAULT_DESKTOP_NAME)
    .describe("Name of the desktop to view (e.g., 'my-desktop')"),
});

const ShutdownDesktopInputSchema = z.object({
  name: z.string().describe("Name of the desktop to shutdown"),
  cleanup: z
    .boolean()
    .optional()
    .describe(
      "Delete the desktop's data directory (default: false, preserves data)",
    ),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format desktop info for display.
 */
function formatDesktopInfo(desktop: DesktopInfo): string {
  const lines = [
    `Name: ${desktop.name}`,
    `Status: ${desktop.status}`,
    `Container ID: ${desktop.containerId}`,
    `Variant: ${desktop.variant}`,
    `Resolution: ${desktop.resolution.width}x${desktop.resolution.height}`,
    `Commands: ${desktop.commands.join(", ")}`,
  ];

  if (desktop.port) {
    lines.push(`Port: ${desktop.port}`);
    lines.push(`URL: http://localhost:${desktop.port}`);
  }

  lines.push(`Created: ${desktop.createdAt}`);

  return lines.join("\n");
}

// ============================================================================
// Server
// ============================================================================

/**
 * Creates a new MCP server instance with virtual desktop tools.
 */
export function createVirtualDesktopServer(): McpServer {
  const server = new McpServer({
    name: "Virtual Desktop Server",
    version: "0.1.0",
  });

  // ==================== ListDesktops ====================
  server.tool(
    "list-desktops",
    "List all virtual desktop containers",
    {},
    async (): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktops = await listDesktops();

      if (desktops.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No virtual desktops found. Use create-desktop to create one.",
            },
          ],
        };
      }

      const text = desktops
        .map((d, i) => `[${i + 1}] ${formatDesktopInfo(d)}`)
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${desktops.length} virtual desktop(s):\n\n${text}`,
          },
        ],
      };
    },
  );

  // ==================== CreateDesktop ====================
  server.tool(
    "create-desktop",
    "Create a new virtual desktop container",
    CreateDesktopInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      try {
        const result = await createDesktop({
          name: args.name,
          variant: args.variant,
          resolution: args.resolution,
          commands: args.commands,
          mounts: args.mounts,
        });

        return {
          content: [
            {
              type: "text",
              text: [
                `Virtual desktop created successfully!`,
                ``,
                `Name: ${result.name}`,
                `Container ID: ${result.containerId}`,
                `Port: ${result.port}`,
                `URL: ${result.url}`,
                ``,
                `The desktop is starting up. Use view-desktop to connect.`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to create desktop: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== ViewDesktop ====================
  const viewDesktopResourceUri = "ui://view-desktop/mcp-app.html";

  registerAppTool(
    server,
    "view-desktop",
    {
      title: "View Desktop",
      description: "View and interact with a virtual desktop",
      inputSchema: ViewDesktopInputSchema.shape,
      _meta: { ui: { resourceUri: viewDesktopResourceUri } },
    },
    async (args: { name: string }): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        // Extract the base name from the full container name for the suggestion
        const baseName = args.name.startsWith(CONTAINER_PREFIX)
          ? args.name.slice(CONTAINER_PREFIX.length)
          : args.name;
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Create it first with: create-desktop { "name": "${baseName}" }. Or use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}). Please start it first.`,
            },
          ],
        };
      }

      if (!desktop.port) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" does not have a port assigned. This may indicate a configuration issue.`,
            },
          ],
        };
      }

      // Wait for VNC endpoint to be ready before returning success
      const vncReady = await waitForVncReady(desktop.port);
      if (!vncReady) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" container is running but VNC endpoint is not responding on port ${desktop.port}. The desktop may still be starting up - try again in a few seconds.`,
            },
          ],
        };
      }

      const url = `http://localhost:${desktop.port}`;
      const wsUrl = `ws://localhost:${desktop.port}/websockify`;
      const portConfig = getPortConfig(desktop.variant as DesktopVariant);

      return {
        content: [
          {
            type: "text",
            text: [
              `Desktop "${desktop.name}" is ready.`,
              ``,
              `Open in browser: ${url}`,
              `WebSocket URL: ${wsUrl}`,
              ``,
              `Status: ${desktop.status}`,
              `Variant: ${desktop.variant}`,
              `Resolution: ${desktop.resolution.width}x${desktop.resolution.height}`,
            ].join("\n"),
          },
        ],
        // Pass structured data to the MCP App
        structuredContent: {
          name: desktop.name,
          url,
          wsUrl,
          resolution: desktop.resolution,
          variant: desktop.variant,
          password: portConfig.password,
          homeFolder: path.join(VIRTUAL_DESKTOPS_DIR, desktop.name, "home"),
        },
        _meta: {},
      };
    },
  );

  // CSP configuration for the MCP App
  const viewDesktopCsp = {
    // Allow loading noVNC library from jsdelivr CDN
    resourceDomains: ["https://cdn.jsdelivr.net"],
    // Allow WebSocket connections to localhost for VNC, and HTTPS for source maps
    connectDomains: [
      "ws://localhost:*",
      "wss://localhost:*",
      "https://cdn.jsdelivr.net",
    ],
  };

  registerAppResource(
    server,
    viewDesktopResourceUri,
    viewDesktopResourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Virtual Desktop Viewer",
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: viewDesktopResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            // CSP must be in content._meta for hosts to read it
            _meta: {
              ui: {
                csp: viewDesktopCsp,
              },
            },
          },
        ],
      };
    },
  );

  // ==================== ShutdownDesktop ====================
  server.tool(
    "shutdown-desktop",
    "Stop and remove a virtual desktop container",
    ShutdownDesktopInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      const success = await shutdownDesktop(args.name, args.cleanup ?? false);

      if (success) {
        const cleanupMessage = args.cleanup
          ? " Data directory has been deleted."
          : " Data directory has been preserved.";

        return {
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" has been shut down and removed.${cleanupMessage}`,
            },
          ],
        };
      } else {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to shutdown desktop "${args.name}". Check Docker logs for details.`,
            },
          ],
        };
      }
    },
  );

  // ==================== OpenHomeFolder ====================
  const OpenHomeFolderInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
  });

  registerAppTool(
    server,
    "open-home-folder",
    {
      title: "Open Home Folder",
      description:
        "Open the desktop's home folder on the host machine's file manager",
      inputSchema: OpenHomeFolderInputSchema.shape,
      _meta: {
        ui: {
          visibility: ["apps"],
        },
      },
    },
    async (args: { name: string }): Promise<CallToolResult> => {
      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      // Construct the host path to the desktop's home folder
      // Use the resolved container name for the path
      const homeFolder = path.join(VIRTUAL_DESKTOPS_DIR, desktop.name, "home");

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use platform-specific open command
        const platform = process.platform;
        let openCmd: string;
        if (platform === "darwin") {
          openCmd = `open "${homeFolder}"`;
        } else if (platform === "win32") {
          openCmd = `explorer "${homeFolder}"`;
        } else {
          // Linux and others
          openCmd = `xdg-open "${homeFolder}"`;
        }

        await execAsync(openCmd);

        return {
          content: [
            {
              type: "text",
              text: `Opened home folder: ${homeFolder}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to open home folder (${homeFolder}): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== TakeScreenshot ====================
  const TakeScreenshotInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
  });

  server.tool(
    "take-screenshot",
    "Take a screenshot of the virtual desktop and return it as an image",
    TakeScreenshotInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use the resolved container name from desktop
        const containerName = desktop.name;

        // Take screenshot using scrot or import (ImageMagick) and output to stdout as PNG
        // Try scrot first, fall back to import (ImageMagick)
        const { stdout } = await execAsync(
          `docker exec ${containerName} bash -c "DISPLAY=:1 scrot -o /tmp/screenshot.png && base64 /tmp/screenshot.png" 2>/dev/null || ` +
            `docker exec ${containerName} bash -c "DISPLAY=:1 import -window root /tmp/screenshot.png && base64 /tmp/screenshot.png"`,
          { maxBuffer: 50 * 1024 * 1024 }, // 50MB buffer for large screenshots
        );

        return {
          content: [
            {
              type: "image",
              data: stdout.trim(),
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== Click ====================
  const ClickInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
    x: z.number().describe("X coordinate to click"),
    y: z.number().describe("Y coordinate to click"),
    button: z
      .enum(["left", "middle", "right"])
      .optional()
      .describe("Mouse button to click (default: left)"),
    clicks: z
      .number()
      .min(1)
      .max(3)
      .optional()
      .describe("Number of clicks (1=single, 2=double, 3=triple; default: 1)"),
  });

  server.tool(
    "click",
    "Click at a specific position on the virtual desktop",
    ClickInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use the resolved container name
        const containerName = desktop.name;

        const button = args.button || "left";
        const clicks = args.clicks || 1;
        const buttonNum = button === "left" ? 1 : button === "middle" ? 2 : 3;

        // Use xdotool to click at the specified position
        const clickCmd =
          clicks === 1
            ? `xdotool mousemove ${args.x} ${args.y} click ${buttonNum}`
            : `xdotool mousemove ${args.x} ${args.y} click --repeat ${clicks} --delay 100 ${buttonNum}`;

        await execAsync(
          `docker exec ${containerName} bash -c "DISPLAY=:1 ${clickCmd}"`,
        );

        return {
          content: [
            {
              type: "text",
              text: `Clicked ${button} button${clicks > 1 ? ` ${clicks} times` : ""} at (${args.x}, ${args.y}) on ${desktop.name}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to click: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== TypeText ====================
  const TypeTextInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
    text: z.string().describe("Text to type"),
    delay: z
      .number()
      .min(0)
      .max(1000)
      .optional()
      .describe("Delay between keystrokes in milliseconds (default: 12)"),
  });

  server.tool(
    "type-text",
    "Type text on the virtual desktop (simulates keyboard input)",
    TypeTextInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use the resolved container name
        const containerName = desktop.name;

        const delay = args.delay ?? 12;

        // Escape the text for shell and use xdotool to type it
        // Using --clearmodifiers to ensure modifier keys don't interfere
        const escapedText = args.text.replace(/'/g, "'\\''");
        await execAsync(
          `docker exec ${containerName} bash -c "DISPLAY=:1 xdotool type --clearmodifiers --delay ${delay} '${escapedText}'"`,
        );

        return {
          content: [
            {
              type: "text",
              text: `Typed "${args.text.length > 50 ? args.text.substring(0, 50) + "..." : args.text}" on ${desktop.name}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to type text: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== PressKey ====================
  const PressKeyInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
    key: z
      .string()
      .describe(
        "Key to press (e.g., 'Return', 'Tab', 'Escape', 'ctrl+c', 'alt+F4', 'super')",
      ),
  });

  server.tool(
    "press-key",
    "Press a key or key combination on the virtual desktop",
    PressKeyInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use the resolved container name
        const containerName = desktop.name;

        // Use xdotool to press the key
        await execAsync(
          `docker exec ${containerName} bash -c "DISPLAY=:1 xdotool key --clearmodifiers ${args.key}"`,
        );

        return {
          content: [
            {
              type: "text",
              text: `Pressed key "${args.key}" on ${desktop.name}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to press key: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== MoveMouse ====================
  const MoveMouseInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
    x: z.number().describe("X coordinate to move to"),
    y: z.number().describe("Y coordinate to move to"),
  });

  server.tool(
    "move-mouse",
    "Move the mouse cursor to a specific position on the virtual desktop",
    MoveMouseInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use the resolved container name
        const containerName = desktop.name;

        await execAsync(
          `docker exec ${containerName} bash -c "DISPLAY=:1 xdotool mousemove ${args.x} ${args.y}"`,
        );

        return {
          content: [
            {
              type: "text",
              text: `Moved mouse to (${args.x}, ${args.y}) on ${desktop.name}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to move mouse: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== Scroll ====================
  const ScrollInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
    direction: z
      .enum(["up", "down", "left", "right"])
      .describe("Scroll direction"),
    amount: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of scroll clicks (default: 3)"),
  });

  server.tool(
    "scroll",
    "Scroll on the virtual desktop",
    ScrollInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use the resolved container name
        const containerName = desktop.name;

        const amount = args.amount || 3;
        // xdotool uses button 4 for scroll up, 5 for scroll down, 6 for left, 7 for right
        const buttonMap = { up: 4, down: 5, left: 6, right: 7 };
        const button = buttonMap[args.direction];

        await execAsync(
          `docker exec ${containerName} bash -c "DISPLAY=:1 xdotool click --repeat ${amount} --delay 50 ${button}"`,
        );

        return {
          content: [
            {
              type: "text",
              text: `Scrolled ${args.direction} ${amount} times on ${desktop.name}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to scroll: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== Exec ====================
  const ExecInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
    command: z
      .string()
      .describe(
        "Command to execute (e.g., 'firefox', 'xfce4-terminal', 'ls -la ~')",
      ),
    background: z
      .boolean()
      .optional()
      .describe(
        "Run in background (default: false). Use true for GUI apps that don't exit.",
      ),
    timeout: z
      .number()
      .min(1000)
      .max(300000)
      .optional()
      .describe("Timeout in milliseconds (default: 30000, max: 300000)"),
  });

  server.tool(
    "exec",
    "Execute a command inside the virtual desktop container. Commands run with DISPLAY=:1 so GUI apps appear in VNC.",
    ExecInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use the resolved container name
        const containerName = desktop.name;

        const timeout = args.timeout ?? 30000;
        const background = args.background ?? false;

        // Escape single quotes in the command
        const escapedCommand = args.command.replace(/'/g, "'\\''");

        // Build the docker exec command
        // DISPLAY=:1 ensures GUI apps show in the VNC display
        const dockerCmd = background
          ? `docker exec -d ${containerName} bash -c "DISPLAY=:1 ${escapedCommand}"`
          : `docker exec ${containerName} bash -c "DISPLAY=:1 ${escapedCommand}"`;

        if (background) {
          // For background commands, just start them and return
          await execAsync(dockerCmd);
          return {
            content: [
              {
                type: "text",
                text: `Started in background: ${args.command}`,
              },
            ],
          };
        } else {
          // For foreground commands, capture output
          const { stdout, stderr } = await execAsync(dockerCmd, {
            timeout,
            maxBuffer: 10 * 1024 * 1024, // 10MB
          });

          const output = [];
          if (stdout.trim()) {
            output.push(`stdout:\n${stdout.trim()}`);
          }
          if (stderr.trim()) {
            output.push(`stderr:\n${stderr.trim()}`);
          }

          return {
            content: [
              {
                type: "text",
                text:
                  output.length > 0
                    ? output.join("\n\n")
                    : `Command completed: ${args.command}`,
              },
            ],
          };
        }
      } catch (error: unknown) {
        // Handle exec errors (non-zero exit codes, timeouts, etc.)
        const execError = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          message?: string;
        };

        if (execError.killed) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Command timed out after ${args.timeout ?? 30000}ms: ${args.command}`,
              },
            ],
          };
        }

        // Include stdout/stderr even on error
        const output = [];
        if (execError.stdout?.trim()) {
          output.push(`stdout:\n${execError.stdout.trim()}`);
        }
        if (execError.stderr?.trim()) {
          output.push(`stderr:\n${execError.stderr.trim()}`);
        }
        if (execError.code !== undefined) {
          output.push(`exit code: ${execError.code}`);
        }

        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                output.length > 0
                  ? `Command failed: ${args.command}\n\n${output.join("\n\n")}`
                  : `Command failed: ${execError.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== ResizeDesktop ====================
  const ResizeDesktopInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
    width: z.number().min(640).max(3840).describe("New width in pixels"),
    height: z.number().min(480).max(2160).describe("New height in pixels"),
  });

  registerAppTool(
    server,
    "resize-desktop",
    {
      title: "Resize Desktop",
      description:
        "Resize the virtual desktop to exact dimensions by restarting VNC. This will briefly disconnect the viewer.",
      inputSchema: ResizeDesktopInputSchema.shape,
      _meta: {
        ui: {
          visibility: ["apps"],
        },
      },
    },
    async (args: {
      name: string;
      width: number;
      height: number;
    }): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        const containerName = desktop.name;
        const resolution = `${args.width}x${args.height}`;

        // Restart VNC with new geometry and restart the window manager
        // The consol/ubuntu-xfce-vnc image uses wm_startup.sh to start XFCE
        const cmd = [
          "vncserver -kill :1 2>/dev/null",
          "sleep 1",
          `vncserver :1 -depth 24 -geometry ${resolution}`,
          "sleep 2",
          // Restart the window manager (XFCE) - the script handles this
          "DISPLAY=:1 /headless/wm_startup.sh &",
        ].join("; ");

        await execAsync(`docker exec ${containerName} bash -c "${cmd}"`, {
          timeout: 30000,
        });

        // Wait for desktop environment to be ready
        await new Promise((resolve) => setTimeout(resolve, 3000));

        return {
          content: [
            {
              type: "text",
              text: `Desktop "${desktop.name}" resized to ${resolution}. The viewer will reconnect automatically.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to resize desktop: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  if (process.argv.includes("--stdio")) {
    await createVirtualDesktopServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3002", 10);
    await startServer(createVirtualDesktopServer, {
      port,
      name: "Virtual Desktop Server",
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
