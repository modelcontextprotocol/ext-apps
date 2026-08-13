import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const client = "@modelcontextprotocol/client";
const server = "@modelcontextprotocol/server";

for (const role of [client, server]) {
  if (!packageJson.peerDependencies?.[role]) {
    throw new Error(`${role} must remain a peer dependency`);
  }
  if (packageJson.peerDependenciesMeta?.[role]?.optional !== true) {
    throw new Error(`${role} must be an optional peer dependency`);
  }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "ext-apps-role-peers-"));
try {
  const npmEnvironment = {
    ...process.env,
    npm_config_cache: join(temporaryRoot, "npm-cache"),
  };
  const packOutput = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temporaryRoot,
      ],
      { cwd: root, encoding: "utf8", env: npmEnvironment },
    ),
  );
  const tarball = join(temporaryRoot, packOutput[0].filename);

  const consumers = [
    {
      name: "app-only",
      dependencies: {
        "@types/node": packageJson.devDependencies["@types/node"],
        [client]: packageJson.devDependencies[client],
        "@modelcontextprotocol/ext-apps": `file:${tarball}`,
      },
      absent: server,
      entry:
        'import { App } from "@modelcontextprotocol/ext-apps"; import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge"; console.log(App, AppBridge);',
    },
    {
      name: "server-only",
      dependencies: {
        "@types/node": packageJson.devDependencies["@types/node"],
        "@modelcontextprotocol/ext-apps": `file:${tarball}`,
        [server]: packageJson.devDependencies[server],
      },
      absent: client,
      entry:
        'import { registerAppTool } from "@modelcontextprotocol/ext-apps/server"; console.log(registerAppTool);',
    },
  ];

  for (const consumer of consumers) {
    const directory = join(temporaryRoot, consumer.name);
    mkdirSync(directory);
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: consumer.dependencies,
      }),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: directory, stdio: "pipe", env: npmEnvironment },
    );

    const absentPath = join(
      directory,
      "node_modules",
      ...consumer.absent.split("/"),
      "package.json",
    );
    try {
      readFileSync(absentPath);
      throw new Error(
        `${consumer.name} unexpectedly installed ${consumer.absent}`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    writeFileSync(join(directory, "entry.ts"), consumer.entry);
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          lib: ["ES2020", "DOM"],
          module: "ESNext",
          moduleResolution: "bundler",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2020",
        },
        include: ["entry.ts"],
      }),
    );
    execFileSync(
      process.execPath,
      [join(root, "node_modules", "typescript", "bin", "tsc")],
      { cwd: directory, stdio: "inherit" },
    );

    const metafile = join(directory, "bundle-meta.json");
    execFileSync(
      join(root, "node_modules", ".bin", "esbuild"),
      [
        "entry.ts",
        "--bundle",
        "--platform=browser",
        "--outfile=bundle.js",
        `--metafile=${metafile}`,
      ],
      { cwd: directory, stdio: "pipe" },
    );
    const bundleInputs = Object.keys(
      JSON.parse(readFileSync(metafile, "utf8")).inputs,
    ).join("\n");
    if (bundleInputs.includes(`/node_modules/${consumer.absent}/`)) {
      throw new Error(
        `${consumer.name} unexpectedly bundled ${consumer.absent}`,
      );
    }
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("Role peer dependency isolation checks passed.");
