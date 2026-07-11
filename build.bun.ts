#!/usr/bin/env bun
import { $ } from "bun";
import { cpSync, mkdirSync } from "node:fs";

// Run TypeScript compiler for type declarations
await $`tsc`;

// Copy schema.json (tsc is emitDeclarationOnly, Bun.build doesn't emit JSON assets).
// Needed for the "./schema.json" package export.
mkdirSync("dist/src/generated", { recursive: true });
cpSync("src/generated/schema.json", "dist/src/generated/schema.json");

const isDevelopment = Bun.env.NODE_ENV === "development";

// Build all JavaScript/TypeScript files
function buildJs(
  entrypoint: string,
  opts: Partial<Parameters<(typeof Bun)["build"]>[0]> = {},
) {
  return Bun.build({
    entrypoints: [entrypoint],
    outdir: "dist",
    target: "browser",
    minify: !isDevelopment,
    ...(isDevelopment
      ? {
          sourcemap: "inline",
        }
      : {}),
    ...opts,
  });
}

// zod is a peerDependency — keep it external so consumers share a single
// zod instance (instanceof ZodError / schema.extend() break with duplicate copies).
const PEER_EXTERNALS = ["@modelcontextprotocol/sdk", "zod"];

await Promise.all([
  buildJs("src/app.ts", {
    outdir: "dist/src",
    external: PEER_EXTERNALS,
  }),
  buildJs("src/app.ts", {
    outdir: "dist/src",
    naming: { entry: "app-with-deps.js" },
  }),
  buildJs("src/app-bridge.ts", {
    outdir: "dist/src",
    external: PEER_EXTERNALS,
  }),
  buildJs("src/react/index.tsx", {
    outdir: "dist/src/react",
    external: ["react", "react-dom", ...PEER_EXTERNALS],
  }),
  buildJs("src/react/index.tsx", {
    outdir: "dist/src/react",
    external: ["react", "react-dom"],
    naming: { entry: "react-with-deps.js" },
  }),
  buildJs("src/server/index.ts", {
    outdir: "dist/src/server",
    external: PEER_EXTERNALS,
  }),
]);
