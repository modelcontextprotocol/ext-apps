import fs from "node:fs/promises";
import path from "node:path";
import {
  getTemplatesDir,
  processTemplate,
  type TemplateName,
} from "./utils.js";

export interface ScaffoldOptions {
  projectName: string;
  template: TemplateName | string;
  targetDir: string;
  sdkVersion: string;
  mcpSdkVersion: string;
}

/**
 * Copy a directory recursively, processing .tmpl files
 */
async function copyDir(
  src: string,
  dest: string,
  replacements: Record<string, string>,
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    let destName = entry.name;

    // Remove .tmpl extension and process content
    const isTmpl = destName.endsWith(".tmpl");
    if (isTmpl) {
      destName = destName.slice(0, -5);
    }

    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, replacements);
    } else {
      let content = await fs.readFile(srcPath, "utf-8");

      // Always process templates for .tmpl files
      if (isTmpl) {
        content = processTemplate(content, replacements);
      }

      await fs.writeFile(destPath, content);
    }
  }
}

/**
 * Scaffold a new MCP App project
 */
export async function scaffold(options: ScaffoldOptions): Promise<void> {
  const { projectName, template, targetDir, sdkVersion, mcpSdkVersion } =
    options;
  const templatesDir = getTemplatesDir();
  const targetPath = path.resolve(process.cwd(), targetDir);

  // Check if target directory already exists
  try {
    await fs.access(targetPath);
    throw new Error(`Directory "${targetDir}" already exists`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  const replacements = {
    name: projectName,
    sdkVersion,
    mcpSdkVersion,
  };

  // Create target directory
  await fs.mkdir(targetPath, { recursive: true });

  // Copy base template
  const baseDir = path.join(templatesDir, "base");
  await copyDir(baseDir, targetPath, replacements);

  // Copy framework-specific template
  const frameworkDir = path.join(templatesDir, template);
  await copyDir(frameworkDir, targetPath, replacements);
}
