import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";
  return {
    plugins: [react()],
    build: {
      sourcemap: isDevelopment ? "inline" : undefined,
      cssMinify: !isDevelopment,
      minify: !isDevelopment,
      rollupOptions: {
        input: [
          "index.html",
          "example-host-vanilla.html",
          "example-host-react.html",
          "sandbox.html",
        ],
      },
      outDir: `dist`,
      emptyOutDir: false,
    },
  };
});
