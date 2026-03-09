import {
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
// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const TOOL_DESCRIPTION = `Renders a ShaderToy-compatible GLSL fragment shader in real-time using WebGL 2.0.

SHADER FORMAT (ShaderToy conventions):
Use ShaderToy's mainImage entry point - do NOT use generic GLSL conventions.

  void mainImage(out vec4 fragColor, in vec2 fragCoord) {
      vec2 uv = fragCoord / iResolution.xy;
      fragColor = vec4(uv, 0.5 + 0.5*sin(iTime), 1.0);
  }

Do NOT use: void main(), gl_FragColor, gl_FragCoord - these will not work.

AVAILABLE UNIFORMS:
- iResolution (vec3): viewport resolution in pixels
- iTime (float): elapsed time in seconds
- iTimeDelta (float): time since last frame
- iFrame (int): frame counter
- iMouse (vec4): mouse/touch position in pixels (see MOUSE INTERACTION below)
- iDate (vec4): year, month, day, seconds
- iChannel0-3 (sampler2D): buffer inputs for multi-pass shaders

MOUSE INTERACTION:
The iMouse uniform provides interactive mouse/touch input (works on mobile):
- iMouse.xy: Current position while button/touch is held down (frozen on release)
- iMouse.zw: Click start position (positive when down, negative when released)
- iMouse.z > 0: Button is currently pressed
- iMouse.z < 0: Button was released
- iMouse.z == 0: Never clicked

Example - camera control:
  vec2 uv = iMouse.xy / iResolution.xy;  // normalized 0-1

Example - detect click:
  if (iMouse.z > 0.0) { /* button is down */ }

MULTI-PASS RENDERING:
- Use bufferA-D parameters for feedback effects, blur chains, simulations
- BufferA output -> iChannel0, BufferB -> iChannel1, etc.
- Buffers can sample their own previous frame for feedback loops

LIMITATIONS - Do NOT use:
- External textures (generate noise/patterns procedurally)
- Keyboard input (iKeyboard not available)
- Audio/microphone input
- VR features (mainVR not available)

For procedural noise:
  float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }`;

const DEFAULT_FRAGMENT_SHADER = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.5 + 0.5*sin(iTime), 1.0);
}`;

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "ShaderToy Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://shadertoy/mcp-app.html";

  // Register the render-shadertoy tool with UI metadata
  registerAppTool(
    server,
    "render-shadertoy",
    {
      title: "ShaderToy Renderer",
      description: TOOL_DESCRIPTION,
      inputSchema: z.object({
        fragmentShader: z
          .string()
          .default(DEFAULT_FRAGMENT_SHADER)
          .describe("Main Image shader - ShaderToy GLSL code"),
        common: z
          .string()
          .optional()
          .describe("Common code shared across all shaders (optional)"),
        bufferA: z
          .string()
          .optional()
          .describe(
            "Buffer A shader code - accessible as iChannel0 (optional)",
          ),
        bufferB: z
          .string()
          .optional()
          .describe(
            "Buffer B shader code - accessible as iChannel1 (optional)",
          ),
        bufferC: z
          .string()
          .optional()
          .describe(
            "Buffer C shader code - accessible as iChannel2 (optional)",
          ),
        bufferD: z
          .string()
          .optional()
          .describe(
            "Buffer D shader code - accessible as iChannel3 (optional)",
          ),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      // Tool execution returns success - actual rendering happens in the UI
      return {
        content: [{ type: "text", text: "Shader rendered successfully" }],
      };
    },
  );

  // Register the resource which returns the bundled HTML/JavaScript for the UI
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
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
