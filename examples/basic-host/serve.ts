#!/usr/bin/env npx tsx
/**
 * HTTP servers for the MCP UI example:
 * - Host server (port 8080): serves host HTML files (React and Vanilla examples)
 * - Sandbox server (port 8081): serves sandbox.html with permissive CSP
 *
 * Running on separate ports ensures proper origin isolation for security.
 */

import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOST_PORT = parseInt(process.env.HOST_PORT || "8080", 10);
const SANDBOX_PORT = parseInt(process.env.SANDBOX_PORT || "8081", 10);
const DIRECTORY = join(__dirname, "dist");

// ============ Host Server (port 8080) ============
const hostApp = express();
hostApp.use(cors());

// Exclude sandbox.html from host server
hostApp.use((req, res, next) => {
  if (req.path === "/sandbox.html") {
    res.status(404).send("Sandbox is served on a different port");
    return;
  }
  next();
});

hostApp.use(express.static(DIRECTORY));

hostApp.get("/", (_req, res) => {
  res.redirect("/index.html");
});

// ============ Sandbox Server (port 8081) ============
const sandboxApp = express();
sandboxApp.use(cors());

// Permissive CSP for sandbox content
sandboxApp.use((_req, res, next) => {
  const csp = [
    "default-src 'self'",
    "img-src * data: blob: 'unsafe-inline'",
    "style-src * blob: data: 'unsafe-inline'",
    "script-src * blob: data: 'unsafe-inline' 'unsafe-eval'",
    "connect-src *",
    "font-src * blob: data:",
    "media-src * blob: data:",
    "frame-src * blob: data:",
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

sandboxApp.get(["/", "/sandbox.html"], (_req, res) => {
  res.sendFile(join(DIRECTORY, "sandbox.html"));
});

sandboxApp.use((_req, res) => {
  res.status(404).send("Only sandbox.html is served on this port");
});

// ============ Start both servers ============
hostApp.listen(HOST_PORT, err => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`Host server:    http://localhost:${HOST_PORT}`);
});

sandboxApp.listen(SANDBOX_PORT, err => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`Sandbox server: http://localhost:${SANDBOX_PORT}`);
  console.log("\nPress Ctrl+C to stop\n");
});
