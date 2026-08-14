import {
  registerAppTool,
  registerAppResource,
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
import { StitchClient } from "./stitch-client.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const RESOURCE_URI = "ui://stitch-design/app.html";

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ type: "error", data: { message } }),
      },
    ],
    isError: true,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "stitch-design",
    version: "1.0.0",
  });

  const stitch = new StitchClient();

  // Tool 1: List Projects
  registerAppTool(
    server,
    "list-projects",
    {
      description:
        'List all Stitch design projects. Shows a visual grid of projects with names and metadata. Each project name is in format "projects/{id}" — use just the numeric ID when calling other tools.',
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe('Filter: "view=owned" (default) or "view=shared"'),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const projects = await stitch.listProjects(args.filter);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "list_projects",
                data: { projects },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Tool 2: List Screens
  registerAppTool(
    server,
    "list-screens",
    {
      description:
        "List all screens in a Stitch project. Shows a thumbnail grid of screen designs.",
      inputSchema: {
        projectId: z
          .string()
          .describe(
            'The Stitch project ID (numeric ID only, not "projects/..." format)',
          ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const screens = await stitch.listScreens(args.projectId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "list_screens",
                data: { projectId: args.projectId, screens },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Tool 3: Design Viewer
  registerAppTool(
    server,
    "design-viewer",
    {
      description:
        "View a Stitch screen design with image preview, HTML/CSS code, and extracted design tokens (colors, fonts, spacing).",
      inputSchema: {
        projectId: z
          .string()
          .describe(
            'The Stitch project ID (numeric ID only, not "projects/..." format)',
          ),
        screenId: z.string().describe("The screen ID to view"),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const [screen, imageData, codeData, designContext] = await Promise.all([
          stitch.getScreen(args.projectId, args.screenId),
          stitch.fetchScreenImage(args.projectId, args.screenId),
          stitch.fetchScreenCode(args.projectId, args.screenId),
          stitch.extractDesignContext(args.projectId, args.screenId),
        ]);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "design_viewer",
                data: { screen, imageData, codeData, designContext },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Tool 4: Generate Design
  registerAppTool(
    server,
    "generate-design",
    {
      description:
        "Generate a new screen design in a Google Stitch project using AI. Creates the design in Stitch and returns a preview with code. Use this tool when the user wants to generate, create, or design a new screen in Stitch. If no projectId is provided, a new project will be automatically created.",
      inputSchema: {
        projectId: z
          .string()
          .optional()
          .describe(
            'The Stitch project ID (numeric ID only, not "projects/..." format). If omitted, a new project is auto-created.',
          ),
        prompt: z
          .string()
          .describe("Text description of the desired screen design"),
        deviceType: z
          .enum(["MOBILE", "DESKTOP", "TABLET"])
          .optional()
          .describe("Target device type (default: MOBILE)"),
        modelId: z
          .enum(["GEMINI_3_PRO", "GEMINI_3_FLASH"])
          .optional()
          .describe("AI model to use (default: GEMINI_3_FLASH)"),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        // Determine or create the target project
        let projectId = args.projectId;
        if (!projectId) {
          const projectTitle =
            args.prompt.length > 50
              ? args.prompt.substring(0, 50).trim() + "..."
              : args.prompt;
          const project = await stitch.createProject(projectTitle);
          projectId = project.name.replace(/^projects\//, "");
        }

        const result = await stitch.generateScreenFromText({
          projectId,
          prompt: args.prompt,
          deviceType: args.deviceType,
          modelId: args.modelId,
        });

        // Extract suggestions from output components if present
        const suggestions: string[] = [];
        if (result.outputComponents) {
          for (const component of result.outputComponents) {
            if (component.suggestions) {
              suggestions.push(...component.suggestions);
            }
          }
        }

        // Use image URL directly from MCP response (avoids redundant API calls)
        const imageData = result.screen?.screenshot?.downloadUrl || "";
        let codeData = { html: "", css: "" };

        // Download HTML code content if available
        if (result.screen?.htmlCode?.downloadUrl) {
          try {
            const html = await stitch.downloadFile(
              result.screen.htmlCode.downloadUrl,
            );
            codeData = { html, css: "" };
          } catch {
            // Code download is optional
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "generate_design",
                data: {
                  screen: result.screen,
                  allScreens:
                    result.allScreens.length > 1
                      ? result.allScreens
                      : undefined,
                  imageData,
                  codeData,
                  suggestions:
                    suggestions.length > 0 ? suggestions : undefined,
                  prompt: args.prompt,
                },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Tool 5: Extract Design Context
  registerAppTool(
    server,
    "extract-design-context",
    {
      description:
        "Extract design tokens (colors, fonts, spacing, layouts) from a Stitch screen. Useful for maintaining design consistency across screens.",
      inputSchema: {
        projectId: z
          .string()
          .describe(
            'The Stitch project ID (numeric ID only, not "projects/..." format)',
          ),
        screenId: z.string().describe("The screen ID to analyze"),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const designContext = await stitch.extractDesignContext(
          args.projectId,
          args.screenId,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "design_context",
                data: designContext,
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Tool 6: Create Project
  registerAppTool(
    server,
    "create-project",
    {
      description:
        "Create a new Stitch design project. Returns the new project with its ID. Use this when the user wants to start a new design project in Stitch.",
      inputSchema: {
        title: z
          .string()
          .optional()
          .describe(
            'Project title (e.g. "Product Dashboard Designs"). Defaults to "New Stitch Project".',
          ),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const title = args.title || "New Stitch Project";
        const project = await stitch.createProject(title);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "create_project",
                data: { project },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // Register shared UI resource with CSP for external images
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
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
                csp: {
                  resourceDomains: [
                    "https://lh3.googleusercontent.com",
                    "https://storage.googleapis.com",
                    "https://contribution.usercontent.google.com",
                  ],
                },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}
