import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  const input = process.env.INPUT;
  if (command === "build" && !input) {
    throw new Error("INPUT env var required for build");
  }

  const portEnv = process.env.PORT;
  const mcpPort = Number.parseInt(
    portEnv ?? process.env.MCP_PORT ?? "3001",
    10,
  );
  const backendPort = Number.parseInt(
    process.env.BACKEND_PORT ?? (portEnv ? String(mcpPort + 1000) : "3102"),
    10,
  );
  const devPort = Number.parseInt(process.env.DEV_PORT ?? "3000", 10);

  return {
    plugins: [react(), viteSingleFile()],
    build: {
      outDir: "dist",
      sourcemap: process.env.NODE_ENV === "development",
      minify: process.env.NODE_ENV !== "development",
      rollupOptions: input ? { input } : undefined,
      target: "esnext",
    },
    server: {
      port: devPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV ?? "production",
      ),
      __BACKEND_URL__: JSON.stringify(`http://localhost:${backendPort}`),
    },
  };
});
