#!/usr/bin/env bun
import { $ } from "bun";

// Run TypeScript compiler for type declarations
await $`tsc`;

const isDevelopment = Bun.env.NODE_ENV === "development";

// Build all JavaScript/TypeScript files
function buildJs(entrypoint: string, opts: Record<string, any> = {}) {
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

await Promise.all([
  buildJs("src/app.ts", {
    outdir: "dist/src",
    external: ["@modelcontextprotocol/sdk"],
  }),
  buildJs("src/app-bridge.ts", {
    outdir: "dist/src",
    external: ["@modelcontextprotocol/sdk"],
  }),
  buildJs("src/react/index.tsx", {
    outdir: "dist/src/react",
    external: ["react", "react-dom", "@modelcontextprotocol/sdk"],
  }),
  buildJs("src/server/index.ts", {
    outdir: "dist/src/server",
    external: ["@modelcontextprotocol/sdk"],
  }),
]);
