import { describe, expect, it } from "bun:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { peerDependencies } from "../package.json";

describe("browser bundle tree shaking", () => {
  it.each(["src/app.ts", "src/app-bridge.ts", "src/react/index.tsx"])(
    "%s does not retain unused Zod locales",
    async (entrypoint) => {
      const root = resolve(import.meta.dir, "..");
      // Match the published SDK build before a consumer bundles its dependencies.
      const sdk = await Bun.build({
        entrypoints: [resolve(root, entrypoint)],
        target: "browser",
        minify: true,
        external: Object.keys(peerDependencies),
      });
      if (!sdk.success) {
        throw new Error(sdk.logs.map((log) => log.message).join("\n"));
      }

      const consumer = await build({
        stdin: {
          contents: await sdk.outputs[0].text(),
          resolveDir: root,
          loader: "js",
        },
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2020",
        minify: true,
        metafile: true,
        write: false,
      });
      const retainedLocales = Object.values(consumer.metafile.outputs).flatMap(
        (output) =>
          Object.entries(output.inputs)
            .filter(([, input]) => input.bytesInOutput > 0)
            .map(([path]) => path.replace(/\\/g, "/"))
            .filter((path) => path.includes("/zod/v4/locales/"))
            .map((path) => path.slice(path.lastIndexOf("/") + 1)),
      );

      expect(retainedLocales).toEqual(["en.js"]);
    },
  );
});
