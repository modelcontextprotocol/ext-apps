#!/usr/bin/env bun
import { $ } from "bun";

await $`tsc -p tsconfig.json`;

const isDevelopment = Bun.env.NODE_ENV === "development";

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

await Promise.all([
  buildJs("src/init.ts", {
    outdir: "dist",
    external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/ext-apps", "zod"],
  }),
  buildJs("src/fetch-wrapper/fetch.ts", {
    outdir: "dist/fetch-wrapper",
    external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/ext-apps", "zod"],
  }),
  buildJs("src/xhr-wrapper/xhr.ts", {
    outdir: "dist/xhr-wrapper",
    external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/ext-apps", "zod"],
  }),
]);
