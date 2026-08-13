import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Current SDK version - read from create-mcp-app's own package.json at runtime */
export const SDK_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
).version;

/** MCP SDK version - read from the installed @modelcontextprotocol/sdk package */
export const MCP_SDK_VERSION: string = (() => {
  // Resolve any entry point in the SDK, then walk up to find the package root
  const sdkEntry = fileURLToPath(
    import.meta.resolve("@modelcontextprotocol/sdk"),
  );
  let dir = path.dirname(sdkEntry);
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      if (pkg.name === "@modelcontextprotocol/sdk")
        return pkg.version as string;
    }
    dir = path.dirname(dir);
  }
  throw new Error("Could not find @modelcontextprotocol/sdk package.json");
})();

/** Available templates */
export const TEMPLATES = [
  { value: "react", label: "React", hint: "React + Vite + TypeScript" },
  {
    value: "vanillajs",
    label: "Vanilla JS",
    hint: "Vanilla JavaScript + Vite + TypeScript",
  },
] as const;

export type TemplateName = (typeof TEMPLATES)[number]["value"];

/** Get the templates directory path */
export function getTemplatesDir(): string {
  // Works both in development (src/) and production (dist/)
  return path.join(__dirname, "..", "templates");
}

/** Validate project name - must be a valid directory and npm package name */
export function validateProjectName(
  name: string | undefined,
): string | undefined {
  if (!name) {
    return undefined; // Allow empty for placeholder default
  }

  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    return "Project name contains invalid characters";
  }

  return undefined;
}

/** Process template placeholders in content */
export function processTemplate(
  content: string,
  replacements: Record<string, string>,
): string {
  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
