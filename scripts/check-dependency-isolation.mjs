import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
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

// App and AppBridge extend the client package's Protocol class, so client is
// a required peer for every consumer. The server helpers are only needed by
// server authors, so server stays optional: View-only consumers must not have
// it installed or bundled.
for (const role of [client, server]) {
  if (!packageJson.peerDependencies?.[role]) {
    throw new Error(`${role} must remain a peer dependency`);
  }
}
if (packageJson.peerDependenciesMeta?.[client]?.optional) {
  throw new Error(`${client} must be a required peer dependency`);
}
if (packageJson.peerDependenciesMeta?.[server]?.optional !== true) {
  throw new Error(`${server} must be an optional peer dependency`);
}

/**
 * Exact version for a synthetic consumer dependency. Read from
 * devDependencies so the consumers exercise the same SDK version the
 * repository tests against; the check would silently drift if a range were
 * allowed here.
 */
function exactDevDependency(name) {
  const version = packageJson.devDependencies?.[name];
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    throw new Error(
      `devDependencies["${name}"] must be an exact version, got ${JSON.stringify(version)}`,
    );
  }
  return version;
}

/** Exact version of a package as installed in this repository's node_modules. */
function installedVersion(name) {
  return JSON.parse(
    readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
  ).version;
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "ext-apps-role-peers-"));
try {
  // Minimal environment: nothing inherited from the caller's npm config
  // (registry overrides, auth tokens, npm_config_* set by an outer `npm run`)
  // can leak into the synthetic consumers.
  const npmEnvironment = {
    PATH: process.env.PATH ?? process.env.Path,
    HOME: process.env.HOME ?? process.env.USERPROFILE,
    npm_config_cache: join(temporaryRoot, "npm-cache"),
  };
  const packDestination = join(temporaryRoot, "pack");
  mkdirSync(packDestination);
  // `npm pack` runs the package's `prepare` script even with --ignore-scripts
  // (pacote's directory fetcher), and its output can pollute stdout, so do not
  // rely on `--json`: locate the tarball on disk instead.
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packDestination],
    { cwd: root, stdio: "pipe", env: npmEnvironment },
  );
  const tarballs = readdirSync(packDestination).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error(`expected exactly one tarball, found ${tarballs}`);
  }
  const tarball = join(packDestination, tarballs[0]);

  const consumers = [
    {
      // View / host author: ext-apps + client (+ react for the hooks entry).
      name: "app-only",
      dependencies: {
        "@types/node": exactDevDependency("@types/node"),
        "@types/react": installedVersion("@types/react"),
        [client]: exactDevDependency(client),
        "@modelcontextprotocol/ext-apps": `file:${tarball}`,
        react: installedVersion("react"),
      },
      absent: server,
      // server must be neither installed (it is an optional peer) nor bundled.
      mustNotInstall: true,
      entry:
        'import { App } from "@modelcontextprotocol/ext-apps"; import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge"; import { useApp } from "@modelcontextprotocol/ext-apps/react"; console.log(App, AppBridge, useApp);',
    },
    {
      // Server author: ext-apps + server. npm auto-installs client as a
      // required peer (its types back the shared wire types), but the server
      // entry must not pull it into a runtime bundle.
      name: "server-only",
      dependencies: {
        "@types/node": exactDevDependency("@types/node"),
        "@modelcontextprotocol/ext-apps": `file:${tarball}`,
        [server]: exactDevDependency(server),
      },
      absent: client,
      mustNotInstall: false,
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
      { cwd: directory, stdio: "inherit", env: npmEnvironment },
    );

    if (consumer.mustNotInstall) {
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
    }

    writeFileSync(join(directory, "entry.ts"), consumer.entry);
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
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
      { cwd: directory, stdio: "inherit" },
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
