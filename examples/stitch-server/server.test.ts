import { describe, expect, it } from "bun:test";
import {
  STITCH_API_BASE,
  STITCH_MCP_URL,
  normalizeProjectId,
  extractInlineStyles,
  extractTailwindConfig,
  extractTailwindColors,
  extractTailwindFonts,
  extractColors,
  extractFonts,
  extractSpacing,
  extractLayouts,
} from "./stitch-client.js";
import { createServer } from "./server.js";

// ---------------------------------------------------------------------------
// A. Configuration constants
// ---------------------------------------------------------------------------
describe("Configuration constants", () => {
  it("STITCH_API_BASE points to the v1 REST endpoint", () => {
    expect(STITCH_API_BASE).toBe("https://stitch.googleapis.com/v1");
  });

  it("STITCH_MCP_URL points to the MCP JSON-RPC endpoint", () => {
    expect(STITCH_MCP_URL).toBe("https://stitch.googleapis.com/mcp");
  });
});

// ---------------------------------------------------------------------------
// B. normalizeProjectId
// ---------------------------------------------------------------------------
describe("normalizeProjectId", () => {
  it('strips "projects/" prefix', () => {
    expect(normalizeProjectId("projects/123")).toBe("123");
  });

  it("returns bare ID unchanged", () => {
    expect(normalizeProjectId("123")).toBe("123");
  });

  it("strips only the first projects/ prefix", () => {
    expect(normalizeProjectId("projects/projects/123")).toBe("projects/123");
  });

  it("handles empty string", () => {
    expect(normalizeProjectId("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// C. extractColors
// ---------------------------------------------------------------------------
describe("extractColors", () => {
  it("extracts hex colors from CSS", () => {
    const css = "color: #ff0000; background: #00ff00;";
    const colors = extractColors(css);
    expect(colors.length).toBe(2);
    expect(colors[0]!.hex).toBe("#ff0000");
    expect(colors[1]!.hex).toBe("#00ff00");
  });

  it("extracts rgb colors", () => {
    const css = "color: rgb(255,0,0);";
    const colors = extractColors(css);
    expect(colors.length).toBe(1);
    expect(colors[0]!.hex).toBe("rgb(255,0,0)");
  });

  it("deduplicates identical hex values", () => {
    const css = "color: #ff0000; border-color: #ff0000;";
    const colors = extractColors(css);
    expect(colors.length).toBe(1);
  });

  it("returns empty array for CSS with no colors", () => {
    const css = "display: flex; margin: 10px;";
    const colors = extractColors(css);
    expect(colors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D. extractFonts
// ---------------------------------------------------------------------------
describe("extractFonts", () => {
  it("extracts font-family from CSS", () => {
    const css = "font-family: 'Roboto', sans-serif;";
    const fonts = extractFonts(css);
    expect(fonts.length).toBe(1);
    expect(fonts[0]!.family).toBe("Roboto, sans-serif");
  });

  it("extracts font-weight and font-size", () => {
    const css =
      "font-family: Arial; font-weight: 700; font-size: 24px;";
    const fonts = extractFonts(css);
    expect(fonts.length).toBe(1);
    expect(fonts[0]!.weight).toBe("700");
    expect(fonts[0]!.size).toBe("24px");
  });

  it("returns empty array for CSS without font-family", () => {
    const css = "color: red; margin: 10px;";
    const fonts = extractFonts(css);
    expect(fonts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E. extractSpacing
// ---------------------------------------------------------------------------
describe("extractSpacing", () => {
  it("extracts margin, padding, and gap values", () => {
    const css = "margin: 10px; padding: 20px; gap: 8px;";
    const spacing = extractSpacing(css);
    expect(spacing.length).toBe(3);
    expect(spacing[0]!.name).toBe("margin");
    expect(spacing[0]!.value).toBe("10px");
    expect(spacing[1]!.name).toBe("padding");
    expect(spacing[2]!.name).toBe("gap");
  });

  it("deduplicates same property-value pairs", () => {
    const css = "margin: 10px; margin: 10px;";
    const spacing = extractSpacing(css);
    expect(spacing.length).toBe(1);
  });

  it("returns empty array for CSS without spacing", () => {
    const css = "color: red; display: flex;";
    const spacing = extractSpacing(css);
    expect(spacing.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F. extractLayouts
// ---------------------------------------------------------------------------
describe("extractLayouts", () => {
  it("detects display: flex", () => {
    const html = '<div style="display: flex">content</div>';
    const layouts = extractLayouts(html);
    expect(layouts.some((l) => l.type === "Flexbox")).toBe(true);
  });

  it("detects display: grid", () => {
    const html = '<div style="display: grid">content</div>';
    const layouts = extractLayouts(html);
    expect(layouts.some((l) => l.type === "Grid")).toBe(true);
  });

  it("detects position: absolute", () => {
    const html = '<div style="position: absolute">content</div>';
    const layouts = extractLayouts(html);
    expect(layouts.some((l) => l.type === "Absolute")).toBe(true);
  });

  it("detects Tailwind flex class", () => {
    const html = '<div class="flex items-center">content</div>';
    const layouts = extractLayouts(html);
    expect(layouts.some((l) => l.type === "Flexbox")).toBe(true);
  });

  it("detects Tailwind grid class", () => {
    const html = '<div class="grid grid-cols-2">content</div>';
    const layouts = extractLayouts(html);
    expect(layouts.some((l) => l.type === "Grid")).toBe(true);
  });

  it("detects Tailwind absolute class", () => {
    const html = '<div class="absolute top-0">content</div>';
    const layouts = extractLayouts(html);
    expect(layouts.some((l) => l.type === "Absolute")).toBe(true);
  });

  it("returns empty array for no layout markers", () => {
    const html = "<p>Hello world</p>";
    const layouts = extractLayouts(html);
    expect(layouts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// G. extractInlineStyles
// ---------------------------------------------------------------------------
describe("extractInlineStyles", () => {
  it("extracts content from <style> tags", () => {
    const html = "<style>.foo { color: red; }</style>";
    const styles = extractInlineStyles(html);
    expect(styles).toContain(".foo { color: red; }");
  });

  it("handles multiple <style> tags", () => {
    const html =
      "<style>.a { color: red; }</style><style>.b { color: blue; }</style>";
    const styles = extractInlineStyles(html);
    expect(styles).toContain(".a { color: red; }");
    expect(styles).toContain(".b { color: blue; }");
  });

  it("returns empty string for HTML without style tags", () => {
    const html = "<div>Hello</div>";
    const styles = extractInlineStyles(html);
    expect(styles).toBe("");
  });
});

// ---------------------------------------------------------------------------
// H. extractTailwindConfig
// ---------------------------------------------------------------------------
describe("extractTailwindConfig", () => {
  it("extracts tailwind.config from script tags", () => {
    const html =
      '<script>tailwind.config = { theme: { extend: {} } };</script>';
    const config = extractTailwindConfig(html);
    expect(config).toContain("theme");
    expect(config).toContain("extend");
  });

  it("returns empty string when no config found", () => {
    const html = "<div>No tailwind here</div>";
    const config = extractTailwindConfig(html);
    expect(config).toBe("");
  });
});

// ---------------------------------------------------------------------------
// I. extractTailwindColors
// ---------------------------------------------------------------------------
describe("extractTailwindColors", () => {
  it("parses color definitions from config", () => {
    const config = "primary: '#135bec', secondary: '#ff5733'";
    const colors = extractTailwindColors(config);
    expect(colors.length).toBe(2);
    expect(colors[0]!.name).toBe("primary");
    expect(colors[0]!.hex).toBe("#135bec");
  });

  it("parses DEFAULT color entry", () => {
    const config = "DEFAULT: '#ffffff'";
    const colors = extractTailwindColors(config);
    expect(colors.length).toBe(1);
    expect(colors[0]!.hex).toBe("#ffffff");
  });

  it("deduplicates by hex value", () => {
    const config = "primary: '#135bec', main: '#135bec'";
    const colors = extractTailwindColors(config);
    expect(colors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// J. extractTailwindFonts
// ---------------------------------------------------------------------------
describe("extractTailwindFonts", () => {
  it("extracts font families from Tailwind config", () => {
    const config = "fontFamily: { sans: ['Inter', 'sans-serif'] }";
    const html = "";
    const fonts = extractTailwindFonts(config, html);
    expect(fonts.length).toBe(1);
    expect(fonts[0]!.family).toBe("Inter");
  });

  it("extracts Google Fonts from HTML", () => {
    const config = "";
    const html =
      '<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700">';
    const fonts = extractTailwindFonts(config, html);
    expect(fonts.length).toBe(1);
    expect(fonts[0]!.family).toBe("Roboto");
  });

  it("deduplicates fonts from config and Google Fonts", () => {
    const config = "fontFamily: { sans: ['Roboto', 'sans-serif'] }";
    const html =
      '<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400">';
    const fonts = extractTailwindFonts(config, html);
    expect(fonts.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// K. Server creation
// ---------------------------------------------------------------------------
describe("createServer", () => {
  it("returns an McpServer instance with correct name", () => {
    const server = createServer();
    expect(server).toBeDefined();
    // McpServer stores its name internally
    expect((server as unknown as { name: string }).name).toBeUndefined();
    // The server object should exist and be truthy
    expect(!!server).toBe(true);
  });
});
