import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const INPUT = process.env.INPUT;
if (!INPUT) {
  throw new Error("INPUT environment variable is not set");
}

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,

    rollupOptions: {
      external: (id) => /^node:|^(child_process|cross-spawn|fs|path|os|crypto|stream|util|net|http|https|events|url|buffer|process)$/.test(id),
      input: INPUT,
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
