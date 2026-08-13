import * as p from "@clack/prompts";
import pc from "picocolors";
import { scaffold } from "./scaffold.js";
import {
  MCP_SDK_VERSION,
  SDK_VERSION,
  TEMPLATES,
  type TemplateName,
  validateProjectName,
} from "./utils.js";

interface CliArgs {
  projectName?: string;
  framework?: string;
  help?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--framework" || arg === "-f") {
      result.framework = args[++i];
    } else if (!arg.startsWith("-") && !result.projectName) {
      result.projectName = arg;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
${pc.bold("create-mcp-app")} - Scaffold MCP App projects

${pc.bold("Usage:")}
  npm create @modelcontextprotocol/mcp-app [project-name] [options]

${pc.bold("Options:")}
  -f, --framework <name>  Framework to use (${TEMPLATES.map((t) => t.value).join(", ")})
  -h, --help              Show this help message

${pc.bold("Examples:")}
  npm create @modelcontextprotocol/mcp-app
  npm create @modelcontextprotocol/mcp-app my-app
  npm create @modelcontextprotocol/mcp-app my-app --framework react
`);
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(" create-mcp-app ")));

  let projectName = args.projectName;
  let framework = args.framework;

  // Prompt for project name if not provided
  if (!projectName) {
    const nameResult = await p.text({
      message: "Project name:",
      placeholder: "my-mcp-app",
      validate: validateProjectName,
    });

    if (p.isCancel(nameResult)) {
      p.cancel("Operation cancelled.");
      process.exit(0);
    }

    projectName = nameResult || "my-mcp-app";
  } else {
    const validation = validateProjectName(projectName);
    if (validation) {
      p.cancel(validation);
      process.exit(1);
    }
  }

  // Prompt for framework if not provided
  if (!framework) {
    const frameworkResult = await p.select({
      message: "Select a framework:",
      options: [...TEMPLATES],
    });

    if (p.isCancel(frameworkResult)) {
      p.cancel("Operation cancelled.");
      process.exit(0);
    }

    framework = frameworkResult as TemplateName;
  } else {
    const validFrameworks = TEMPLATES.map((t) => t.value) as readonly string[];
    if (!validFrameworks.includes(framework)) {
      p.cancel(
        `Invalid framework "${framework}". Valid options: ${validFrameworks.join(", ")}`,
      );
      process.exit(1);
    }
  }

  const s = p.spinner();

  try {
    s.start("Creating project...");

    await scaffold({
      projectName,
      template: framework!,
      targetDir: projectName,
      sdkVersion: SDK_VERSION,
      mcpSdkVersion: MCP_SDK_VERSION,
    });

    s.stop("Project created!");

    s.start("Installing dependencies...");
    const { execSync } = await import("node:child_process");
    execSync("npm install", {
      cwd: projectName,
      stdio: "ignore",
    });
    s.stop("Dependencies installed!");

    p.note([`cd ${projectName}`, "npm run dev"].join("\n"), "Next steps:");

    p.outro(pc.green("Happy building!"));
  } catch (error) {
    s.stop("Failed!");
    throw error;
  }
}
