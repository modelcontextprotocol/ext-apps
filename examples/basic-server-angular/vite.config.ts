import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import angular from "@analogjs/vite-plugin-angular";
const INPUT = process.env.INPUT;
if (!INPUT) {
  throw new Error("INPUT environment variable is not set");
}

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
  resolve: {
    mainFields: ["module"],
  },
  plugins: [angular(), viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,

    rollupOptions: {
      input: INPUT,
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
