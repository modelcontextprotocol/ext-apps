import { GoogleAuth } from "google-auth-library";

export const STITCH_API_BASE = "https://stitch.googleapis.com/v1";
export const STITCH_MCP_URL = "https://stitch.googleapis.com/mcp";

export interface StitchProject {
  name: string;
  title: string;
  createTime: string;
  updateTime: string;
}

interface FileReference {
  name: string;
  downloadUrl: string;
}

export interface StitchScreen {
  name: string;
  id?: string;
  title?: string;
  screenshot?: FileReference;
  htmlCode?: FileReference;
  cssCode?: FileReference;
  deviceType?: string;
  theme?: Record<string, unknown>;
  prompt?: string;
  width?: string;
  height?: string;
  screenType?: string;
  generatedBy?: string;
  createTime?: string;
  updateTime?: string;
}

export interface DesignContext {
  colors: Array<{ name: string; hex: string; usage: string }>;
  fonts: Array<{
    family: string;
    weight: string;
    size: string;
    usage: string;
  }>;
  spacing: Array<{ name: string; value: string }>;
  layouts: Array<{ type: string; description: string }>;
}

export interface GenerateScreenOptions {
  projectId: string;
  prompt: string;
  deviceType?: "MOBILE" | "DESKTOP" | "TABLET";
  modelId?: "GEMINI_3_PRO" | "GEMINI_3_FLASH";
}

// =====================================================================
// Pure utility functions (exported for testing)
// =====================================================================

export function normalizeProjectId(projectId: string): string {
  return projectId.replace(/^projects\//, "");
}

export function extractInlineStyles(html: string): string {
  const parts: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    parts.push(match[1]!);
  }
  return parts.join("\n");
}

export function extractTailwindConfig(html: string): string {
  const configRegex =
    /tailwind\.config\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/;
  const match = configRegex.exec(html);
  return match ? match[1]! : "";
}

export function extractTailwindColors(
  config: string,
): DesignContext["colors"] {
  const colors: DesignContext["colors"] = [];
  const colorRegex =
    /['"]?(\w+)['"]?\s*:\s*['"]?(#[0-9a-fA-F]{3,8})['"]?/g;
  const seen = new Set<string>();
  let match;
  while ((match = colorRegex.exec(config)) !== null) {
    const name = match[1]!;
    const hex = match[2]!;
    if (!seen.has(hex.toLowerCase())) {
      seen.add(hex.toLowerCase());
      colors.push({ name, hex, usage: "Tailwind theme" });
    }
  }
  return colors;
}

export function extractTailwindFonts(
  config: string,
  html: string,
): DesignContext["fonts"] {
  const fonts: DesignContext["fonts"] = [];
  const seen = new Set<string>();

  const fontRegex =
    /fontFamily[\s\S]*?['"](\w[\w\s]*)['"](?:\s*,|\s*\])/g;
  let match;
  while ((match = fontRegex.exec(config)) !== null) {
    const family = match[1]!.trim();
    if (family && !seen.has(family.toLowerCase())) {
      seen.add(family.toLowerCase());
      fonts.push({ family, weight: "400", size: "16px", usage: "Tailwind theme" });
    }
  }

  const googleFontsRegex =
    /fonts\.googleapis\.com\/css2?\?family=([^&"'<>\s]+)/g;
  while ((match = googleFontsRegex.exec(html)) !== null) {
    const family = decodeURIComponent(match[1]!)
      .split(":")[0]!
      .replace(/\+/g, " ")
      .trim();
    if (family && !seen.has(family.toLowerCase())) {
      seen.add(family.toLowerCase());
      fonts.push({ family, weight: "400", size: "16px", usage: "Google Fonts" });
    }
  }

  return fonts;
}

export function extractColors(css: string): DesignContext["colors"] {
  const colors: DesignContext["colors"] = [];
  const colorRegex =
    /(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\)|hsl[a]?\([^)]+\))/g;
  const seen = new Set<string>();

  let match;
  while ((match = colorRegex.exec(css)) !== null) {
    const hex = match[1]!;
    if (!seen.has(hex)) {
      seen.add(hex);
      colors.push({
        name: `color-${colors.length + 1}`,
        hex,
        usage: "Extracted from CSS",
      });
    }
  }
  return colors;
}

export function extractFonts(css: string): DesignContext["fonts"] {
  const fonts: DesignContext["fonts"] = [];
  const fontFamilyRegex = /font-family:\s*([^;]+)/g;
  const fontSizeRegex = /font-size:\s*([^;]+)/g;
  const fontWeightRegex = /font-weight:\s*([^;]+)/g;

  const families = new Set<string>();
  let match;

  while ((match = fontFamilyRegex.exec(css)) !== null) {
    const family = match[1]!.trim().replace(/['"]/g, "");
    if (!families.has(family)) {
      families.add(family);
    }
  }

  const sizes: string[] = [];
  while ((match = fontSizeRegex.exec(css)) !== null) {
    sizes.push(match[1]!.trim());
  }

  const weights: string[] = [];
  while ((match = fontWeightRegex.exec(css)) !== null) {
    weights.push(match[1]!.trim());
  }

  for (const family of families) {
    fonts.push({
      family,
      weight: weights[0] || "400",
      size: sizes[0] || "16px",
      usage: "Extracted from CSS",
    });
  }

  return fonts;
}

export function extractSpacing(css: string): DesignContext["spacing"] {
  const spacing: DesignContext["spacing"] = [];
  const spacingRegex = /(margin|padding|gap):\s*([^;]+)/g;
  const seen = new Set<string>();

  let match;
  while ((match = spacingRegex.exec(css)) !== null) {
    const value = match[2]!.trim();
    const key = `${match[1]}-${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      spacing.push({
        name: match[1]!,
        value,
      });
    }
  }
  return spacing;
}

export function extractLayouts(html: string): DesignContext["layouts"] {
  const layouts: DesignContext["layouts"] = [];

  if (
    html.includes("display: flex") ||
    html.includes("display:flex") ||
    /\bflex\b/.test(html)
  ) {
    layouts.push({
      type: "Flexbox",
      description: "Uses CSS Flexbox for layout",
    });
  }
  if (
    html.includes("display: grid") ||
    html.includes("display:grid") ||
    /\bgrid\b/.test(html)
  ) {
    layouts.push({ type: "Grid", description: "Uses CSS Grid for layout" });
  }
  if (
    html.includes("position: absolute") ||
    html.includes("position:absolute") ||
    /\babsolute\b/.test(html)
  ) {
    layouts.push({
      type: "Absolute",
      description: "Uses absolute positioning",
    });
  }

  return layouts;
}

// =====================================================================
// StitchClient class (network-dependent methods)
// =====================================================================

export class StitchClient {
  private auth: GoogleAuth;
  private projectId: string;

  constructor() {
    this.auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    this.projectId = process.env["GOOGLE_CLOUD_PROJECT"] || "";
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token.token) {
      headers["Authorization"] = `Bearer ${token.token}`;
    }
    if (this.projectId) {
      headers["X-Goog-User-Project"] = this.projectId;
    }
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = await this.getHeaders();
    const url = `${STITCH_API_BASE}${path}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stitch API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Call a Stitch tool via the MCP JSON-RPC endpoint.
   * Some operations (like screen generation) are only available through
   * the MCP endpoint, not the REST API.
   */
  private async mcpRequest<T>(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const headers = await this.getHeaders();
    const body = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: Date.now(),
    };

    const response = await fetch(STITCH_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stitch MCP error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      result?: T;
      error?: { code?: number; message: string };
    };
    if (data.error) {
      throw new Error(`Stitch MCP error: ${data.error.message}`);
    }
    return data.result as T;
  }

  async listProjects(filter?: string): Promise<StitchProject[]> {
    const params = new URLSearchParams();
    if (filter) {
      params.set("filter", filter);
    }
    const query = params.toString();
    const path = `/projects${query ? `?${query}` : ""}`;
    const result = await this.request<{ projects?: StitchProject[] }>(
      "GET",
      path,
    );
    return result.projects || [];
  }

  async getProject(name: string): Promise<StitchProject> {
    return this.request<StitchProject>("GET", `/${name}`);
  }

  async createProject(title: string): Promise<StitchProject> {
    return this.request<StitchProject>("POST", "/projects", { title });
  }

  async listScreens(projectId: string): Promise<StitchScreen[]> {
    const pid = normalizeProjectId(projectId);
    const result = await this.request<{ screens?: StitchScreen[] }>(
      "GET",
      `/projects/${pid}/screens`,
    );
    return result.screens || [];
  }

  async getScreen(
    projectId: string,
    screenId: string,
  ): Promise<StitchScreen> {
    const pid = normalizeProjectId(projectId);
    return this.request<StitchScreen>(
      "GET",
      `/projects/${pid}/screens/${screenId}`,
    );
  }

  async generateScreenFromText(options: GenerateScreenOptions): Promise<{
    screen: StitchScreen;
    allScreens: StitchScreen[];
    outputComponents?: Array<{ text?: string; suggestions?: string[] }>;
  }> {
    const projectId = normalizeProjectId(options.projectId);
    const args: Record<string, unknown> = {
      projectId,
      prompt: options.prompt,
    };
    if (options.deviceType) args["deviceType"] = options.deviceType;
    if (options.modelId) args["modelId"] = options.modelId;

    const mcpResult = await this.mcpRequest<Record<string, unknown>>(
      "generate_screen_from_text",
      args,
    );

    let screen: StitchScreen = { name: "" };
    const allScreens: StitchScreen[] = [];
    const suggestions: string[] = [];

    const structured = mcpResult.structuredContent as
      | Record<string, unknown>
      | undefined;
    if (structured?.outputComponents) {
      const components = structured.outputComponents as Array<
        Record<string, unknown>
      >;
      for (const comp of components) {
        if (comp.design) {
          const design = comp.design as { screens?: StitchScreen[] };
          if (design.screens?.length) {
            allScreens.push(...design.screens);
            if (!screen.name) {
              screen = design.screens[0]!;
            }
          }
        }
        if (typeof comp.suggestion === "string") {
          suggestions.push(comp.suggestion);
        }
      }
    }

    if (!screen.name) {
      const content = mcpResult.content as
        | Array<{ type: string; text?: string }>
        | undefined;
      if (content) {
        for (const item of content) {
          if (item.type === "text" && item.text) {
            try {
              const parsed = JSON.parse(item.text);
              if (parsed.outputComponents) {
                for (const comp of parsed.outputComponents as Array<
                  Record<string, unknown>
                >) {
                  if (comp.design) {
                    const design = comp.design as {
                      screens?: StitchScreen[];
                    };
                    if (design.screens?.length) {
                      allScreens.push(...design.screens);
                      if (!screen.name) screen = design.screens[0]!;
                    }
                  }
                  if (typeof comp.suggestion === "string")
                    suggestions.push(comp.suggestion);
                }
              }
            } catch {
              /* not JSON */
            }
          }
        }
      }
    }

    const outputComponents: Array<{
      text?: string;
      suggestions?: string[];
    }> = [];
    if (suggestions.length > 0) {
      outputComponents.push({ suggestions });
    }

    return {
      screen,
      allScreens,
      outputComponents:
        outputComponents.length > 0 ? outputComponents : undefined,
    };
  }

  async extractDesignContext(
    projectId: string,
    screenId: string,
  ): Promise<DesignContext> {
    const pid = normalizeProjectId(projectId);
    const context: DesignContext = {
      colors: [],
      fonts: [],
      spacing: [],
      layouts: [],
    };

    const screen = await this.getScreen(pid, screenId);
    const { html, css } = await this.fetchScreenCode(pid, screenId);

    const inlineStyles = html ? extractInlineStyles(html) : "";
    const allCss = [css, inlineStyles].filter(Boolean).join("\n");

    if (allCss) {
      context.colors = extractColors(allCss);
      context.fonts = extractFonts(allCss);
      context.spacing = extractSpacing(allCss);
    }

    if (html) {
      const tailwindConfig = extractTailwindConfig(html);
      if (tailwindConfig) {
        context.colors.push(...extractTailwindColors(tailwindConfig));
        context.fonts.push(...extractTailwindFonts(tailwindConfig, html));
      }
      context.layouts = extractLayouts(html);
    }

    if (screen.theme) {
      const theme = screen.theme as Record<string, unknown>;
      if (theme.customColor && typeof theme.customColor === "string") {
        const hasColor = context.colors.some(
          (c) =>
            c.hex.toLowerCase() ===
            (theme.customColor as string).toLowerCase(),
        );
        if (!hasColor) {
          context.colors.unshift({
            name: "primary",
            hex: theme.customColor as string,
            usage: "Theme primary color",
          });
        }
      }
      if (theme.font && typeof theme.font === "string") {
        const fontName = (theme.font as string)
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        const hasFont = context.fonts.some((f) =>
          f.family.toLowerCase().includes(fontName.toLowerCase()),
        );
        if (!hasFont) {
          context.fonts.unshift({
            family: fontName,
            weight: "400",
            size: "16px",
            usage: "Theme font",
          });
        }
      }
      if (theme.colorMode && typeof theme.colorMode === "string") {
        context.layouts.unshift({
          type: theme.colorMode as string,
          description: `${theme.colorMode} color mode`,
        });
      }
    }

    return context;
  }

  async fetchScreenImage(
    projectId: string,
    screenId: string,
  ): Promise<string> {
    const pid = normalizeProjectId(projectId);
    const screen = await this.getScreen(pid, screenId);
    return screen.screenshot?.downloadUrl || "";
  }

  async fetchScreenCode(
    projectId: string,
    screenId: string,
  ): Promise<{ html: string; css: string }> {
    const pid = normalizeProjectId(projectId);
    const screen = await this.getScreen(pid, screenId);
    let html = "";
    let css = "";

    if (screen.htmlCode?.downloadUrl) {
      html = await this.downloadFile(screen.htmlCode.downloadUrl);
    }
    if (screen.cssCode?.downloadUrl) {
      css = await this.downloadFile(screen.cssCode.downloadUrl);
    }
    return { html, css };
  }

  async downloadFile(url: string): Promise<string> {
    try {
      const needsAuth = !url.includes("usercontent.google.com");
      const options: RequestInit = {};
      if (needsAuth) {
        options.headers = await this.getHeaders();
      }
      const response = await fetch(url, options);
      if (!response.ok) return "";
      return response.text();
    } catch {
      return "";
    }
  }
}
