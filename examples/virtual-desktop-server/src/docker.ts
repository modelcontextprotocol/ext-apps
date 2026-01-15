/**
 * Docker utilities for managing virtual desktop containers.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const execAsync = promisify(exec);

/** Prefix for all virtual desktop container names */
export const CONTAINER_PREFIX = "mcp-apps-vd-";

/** Base directory for virtual desktop data */
export const VIRTUAL_DESKTOPS_DIR = path.join(
  homedir(),
  ".mcp-virtual-desktops-app",
);

/** Docker label key for identifying our containers */
export const LABEL_KEY = "vd.managed";

/** Available desktop variants */
export const DESKTOP_VARIANTS = [
  // Standard webvnc-docker (TigerVNC + noVNC, XFCE)
  "xfce",
  // LinuxServer webtop variants (older KasmVNC-based tags)
  "webtop-ubuntu-xfce",
  "webtop-alpine-xfce",
] as const;

export type DesktopVariant = (typeof DESKTOP_VARIANTS)[number];

export const DEFAULT_VARIANT: DesktopVariant = "xfce";
export const DEFAULT_RESOLUTION = { width: 1280, height: 720 };
export const DEFAULT_COMMANDS: string[] = [];

/** Docker image for each variant */
const VARIANT_IMAGES: Record<DesktopVariant, string> = {
  // ConSol's docker-headless-vnc-container: Ubuntu with XFCE, TigerVNC + noVNC
  // https://github.com/ConSol/docker-headless-vnc-container
  // Port 6901 for noVNC web UI and websockify
  xfce: "consol/ubuntu-xfce-vnc:latest",
  // LinuxServer webtop with KasmVNC (pin to old tag before Selkies migration)
  "webtop-ubuntu-xfce":
    "lscr.io/linuxserver/webtop:ubuntu-xfce-version-2024.01.01",
  "webtop-alpine-xfce":
    "lscr.io/linuxserver/webtop:alpine-xfce-version-2024.01.01",
};

/** Port configuration for each variant type */
interface PortConfig {
  httpPort: number; // Web UI port inside container
  vncPort?: number; // Raw VNC port (if available)
  websocketPath: string; // Path for websocket connection
  password: string; // VNC password (empty if none required)
}

export function getPortConfig(variant: DesktopVariant): PortConfig {
  if (variant === "xfce") {
    // ConSol's ubuntu-xfce-vnc uses port 6901 for noVNC, 5901 for VNC
    // Default password is "vncpassword"
    return {
      httpPort: 6901,
      vncPort: 5901,
      websocketPath: "/websockify",
      password: "vncpassword",
    };
  }
  // LinuxServer webtop (KasmVNC)
  return { httpPort: 3000, websocketPath: "/websockify", password: "" };
}

export interface DesktopInfo {
  name: string;
  containerId: string;
  status: "running" | "exited" | "paused" | "created" | "unknown";
  port: number | null;
  variant: string;
  resolution: { width: number; height: number };
  commands: string[];
  createdAt: string;
}

export interface CreateDesktopOptions {
  name: string;
  variant?: DesktopVariant;
  resolution?: { width: number; height: number };
  commands?: string[];
  mounts?: Array<{
    hostPath: string;
    containerPath: string;
    readonly?: boolean;
  }>;
}

export interface CreateDesktopResult {
  containerId: string;
  name: string;
  port: number;
  url: string;
}

/**
 * Regex for valid Docker container names.
 * Must start with alphanumeric, followed by alphanumeric, underscore, dot, or dash.
 */
const VALID_CONTAINER_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * Validate a container name for use in shell commands.
 * Throws an error if the name contains invalid characters that could allow injection.
 *
 * @param name - The container name to validate
 * @throws Error if the name is invalid
 */
export function validateContainerName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error("Container name must be a non-empty string");
  }
  if (!VALID_CONTAINER_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid container name "${name}". Must match [a-zA-Z0-9][a-zA-Z0-9_.-]*`,
    );
  }
  // Additional safety: reject names that could be interpreted as shell options
  if (name.startsWith("-")) {
    throw new Error("Container name cannot start with a dash");
  }
}

/**
 * Resolve a logical desktop name to the full container name.
 * Accepts either:
 * - Logical name (e.g., "my-desktop") → resolves to "mcp-apps-vd-my-desktop"
 * - Full name (e.g., "mcp-apps-vd-my-desktop") → returns as-is
 *
 * @param name - The desktop name (logical or full)
 * @returns The full container name with prefix
 */
export function resolveContainerName(name: string): string {
  validateContainerName(name);
  if (name.startsWith(CONTAINER_PREFIX)) {
    return name;
  }
  return CONTAINER_PREFIX + name;
}

/**
 * Sanitize a name to be valid as a Docker container name.
 * Docker container names must match [a-zA-Z0-9][a-zA-Z0-9_.-]*
 */
export function sanitizeName(name: string): string {
  // Replace invalid chars with dash
  let sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, "-");
  // Remove consecutive dashes
  sanitized = sanitized.replace(/-+/g, "-");
  // Remove leading/trailing dashes
  sanitized = sanitized.replace(/^-+|-+$/g, "");
  // Ensure starts with alphanumeric
  if (!/^[a-zA-Z0-9]/.test(sanitized)) {
    sanitized = "x" + sanitized;
  }
  // If empty after sanitization, use a default
  if (!sanitized) {
    sanitized = "desktop";
  }
  return CONTAINER_PREFIX + sanitized;
}

/**
 * Get a unique container name by incrementing if needed.
 */
export async function getUniqueName(baseName: string): Promise<string> {
  const sanitized = sanitizeName(baseName);
  const existing = await listContainerNames();

  if (!existing.has(sanitized)) {
    return sanitized;
  }

  // Try incrementing a number suffix
  const match = sanitized.match(/^(.+)-(\d+)$/);
  if (match) {
    const base = match[1];
    let num = parseInt(match[2], 10);
    while (existing.has(`${base}-${++num}`)) {
      // Keep incrementing
    }
    return `${base}-${num}`;
  }

  // Append a number
  let num = 1;
  while (existing.has(`${sanitized}-${++num}`)) {
    // Keep incrementing
  }
  return `${sanitized}-${num}`;
}

/**
 * List all container names (including stopped ones).
 */
async function listContainerNames(): Promise<Set<string>> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "label=${LABEL_KEY}" --format "{{.Names}}"`,
    );
    return new Set(stdout.trim().split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Find an available port in the given range.
 */
export async function findAvailablePort(
  startPort: number = 13000,
  endPort: number = 14000,
): Promise<number> {
  // Get list of ports currently in use by our containers
  const usedPorts = new Set<number>();

  try {
    const { stdout } = await execAsync(
      `docker ps --filter "label=${LABEL_KEY}" --format "{{.Ports}}"`,
    );
    // Match any port mapping: 0.0.0.0:HOSTPORT->CONTAINERPORT
    const portMatches = stdout.matchAll(/0\.0\.0\.0:(\d+)->\d+/g);
    for (const match of portMatches) {
      usedPorts.add(parseInt(match[1], 10));
    }
  } catch {
    // Ignore errors, just start from startPort
  }

  // Find first available port
  for (let port = startPort; port <= endPort; port++) {
    if (!usedPorts.has(port)) {
      // Double-check by trying to see if anything is listening
      try {
        await execAsync(`lsof -i :${port} -t`);
        // Port is in use
      } catch {
        // Port is available (lsof returns error when nothing found)
        return port;
      }
    }
  }

  throw new Error(`No available ports in range ${startPort}-${endPort}`);
}

/**
 * Create the autostart script for the given commands.
 */
async function createAutostartScript(
  desktopDir: string,
  commands: string[],
): Promise<void> {
  const autostartDir = path.join(desktopDir, "autostart");
  await mkdir(autostartDir, { recursive: true });

  const scriptContent = `#!/bin/bash
# Auto-generated startup script for virtual desktop
sleep 2  # Wait for desktop to initialize

${commands.map((cmd) => `${cmd} &`).join("\n")}

# Keep script running to prevent immediate exit
wait
`;

  const scriptPath = path.join(autostartDir, "startup.sh");
  await writeFile(scriptPath, scriptContent, { mode: 0o755 });
}

/**
 * List all virtual desktop containers.
 */
export async function listDesktops(): Promise<DesktopInfo[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "label=${LABEL_KEY}" --format "{{json .}}"`,
    );

    const lines = stdout.trim().split("\n").filter(Boolean);
    const desktops: DesktopInfo[] = [];

    for (const line of lines) {
      const container = JSON.parse(line);

      // Get labels from inspect
      const { stdout: inspectOut } = await execAsync(
        `docker inspect --format "{{json .Config.Labels}}" ${container.ID}`,
      );
      const labels = JSON.parse(inspectOut.trim());

      // Parse port from Ports field (e.g., "0.0.0.0:13000->6901/tcp")
      let port: number | null = null;
      const portMatch = container.Ports?.match(/0\.0\.0\.0:(\d+)->\d+/);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
      }

      // Parse resolution from label
      let resolution = DEFAULT_RESOLUTION;
      if (labels["vd.resolution"]) {
        const [w, h] = labels["vd.resolution"].split("x").map(Number);
        if (w && h) resolution = { width: w, height: h };
      }

      // Parse commands from label
      let commands = DEFAULT_COMMANDS;
      if (labels["vd.commands"]) {
        commands = labels["vd.commands"].split(",");
      }

      // Normalize status
      let status: DesktopInfo["status"] = "unknown";
      const state = container.State?.toLowerCase() || "";
      if (state === "running") status = "running";
      else if (state === "exited") status = "exited";
      else if (state === "paused") status = "paused";
      else if (state === "created") status = "created";

      desktops.push({
        name: container.Names,
        containerId: container.ID,
        status,
        port,
        variant: labels["vd.variant"] || DEFAULT_VARIANT,
        resolution,
        commands,
        createdAt: labels["vd.created"] || container.CreatedAt,
      });
    }

    return desktops;
  } catch (error) {
    console.error("Error listing desktops:", error);
    return [];
  }
}

/**
 * Create a new virtual desktop container.
 */
export async function createDesktop(
  options: CreateDesktopOptions,
): Promise<CreateDesktopResult> {
  const {
    name,
    variant = DEFAULT_VARIANT,
    resolution = DEFAULT_RESOLUTION,
    commands = DEFAULT_COMMANDS,
    mounts = [],
  } = options;

  // Get unique container name
  const containerName = await getUniqueName(name);

  // Find available port
  const port = await findAvailablePort();

  // Get image and port config for this variant
  const image = VARIANT_IMAGES[variant];
  const portConfig = getPortConfig(variant);

  // Create desktop directory
  const desktopDir = path.join(VIRTUAL_DESKTOPS_DIR, containerName);
  const homeDir = path.join(desktopDir, "home");
  await mkdir(homeDir, { recursive: true });

  // Create autostart script if commands provided
  if (commands.length > 0) {
    await createAutostartScript(desktopDir, commands);
  }

  // Build docker run command
  const labels = [
    `--label ${LABEL_KEY}=true`,
    `--label vd.variant=${variant}`,
    `--label vd.resolution=${resolution.width}x${resolution.height}`,
    `--label vd.commands=${commands.join(",")}`,
    `--label vd.websocketPath=${portConfig.websocketPath}`,
    `--label vd.created=${new Date().toISOString()}`,
  ];

  // Volume mounts differ by variant
  const volumes: string[] = [];
  if (variant.startsWith("webtop-")) {
    // LinuxServer webtop uses /config for home
    volumes.push(`-v "${homeDir}:/config"`);
    if (commands.length > 0) {
      volumes.push(
        `-v "${path.join(desktopDir, "autostart")}:/config/autostart"`,
      );
    }
  }
  // Add custom mounts
  volumes.push(
    ...mounts.map(
      (m) => `-v "${m.hostPath}:${m.containerPath}${m.readonly ? ":ro" : ""}"`,
    ),
  );

  // Environment variables differ by variant
  const envVars: string[] = ["-e TZ=Etc/UTC"];
  if (variant.startsWith("webtop-")) {
    envVars.push("-e PUID=1000", "-e PGID=1000");
    envVars.push(`-e CUSTOM_RES=${resolution.width}x${resolution.height}`);
  } else if (variant === "xfce") {
    // webvnc-docker uses RESOLUTION env var
    envVars.push(`-e RESOLUTION=${resolution.width}x${resolution.height}`);
  }

  const dockerCmd = [
    "docker run -d",
    `--name ${containerName}`,
    '--shm-size="1gb"',
    `-p ${port}:${portConfig.httpPort}`,
    ...labels,
    ...volumes,
    ...envVars,
    image,
  ].join(" ");

  const { stdout } = await execAsync(dockerCmd);
  const containerId = stdout.trim();

  // Wait for container to be running (with timeout)
  const startTime = Date.now();
  const timeout = 30000; // 30 seconds
  const pollInterval = 500; // 500ms

  while (Date.now() - startTime < timeout) {
    try {
      const { stdout: stateOut } = await execAsync(
        `docker inspect --format "{{.State.Status}}" ${containerId}`,
      );
      const state = stateOut.trim().toLowerCase();

      if (state === "running") {
        return {
          containerId,
          name: containerName,
          port,
          url: `http://localhost:${port}`,
        };
      }

      if (state === "exited" || state === "dead") {
        // Container failed to start - get logs for error message
        const { stdout: logs } = await execAsync(
          `docker logs --tail 20 ${containerId} 2>&1`,
        ).catch(() => ({ stdout: "" }));
        throw new Error(
          `Container exited immediately. Logs:\n${logs || "(no logs available)"}`,
        );
      }

      // Still starting, wait and poll again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Container exited")
      ) {
        throw error;
      }
      // Inspection failed, container might not exist yet - keep polling
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  // Timeout - container didn't reach running state
  throw new Error(
    `Container failed to start within ${timeout / 1000} seconds. Check Docker logs with: docker logs ${containerName}`,
  );
}

/**
 * Get information about a specific desktop.
 */
export async function getDesktop(name: string): Promise<DesktopInfo | null> {
  const fullName = resolveContainerName(name);
  const desktops = await listDesktops();
  return desktops.find((d) => d.name === fullName) || null;
}

/**
 * Shutdown and remove a virtual desktop container.
 */
export async function shutdownDesktop(
  name: string,
  cleanup: boolean = false,
): Promise<boolean> {
  const fullName = resolveContainerName(name);
  try {
    // Stop the container
    await execAsync(`docker stop ${fullName}`).catch(() => {});

    // Remove the container
    await execAsync(`docker rm ${fullName}`);

    // Optionally clean up the data directory
    if (cleanup) {
      const desktopDir = path.join(VIRTUAL_DESKTOPS_DIR, fullName);
      await rm(desktopDir, { recursive: true, force: true });
    }

    return true;
  } catch (error) {
    console.error("Error shutting down desktop:", error);
    return false;
  }
}

/**
 * Check if Docker is available.
 */
export async function checkDocker(): Promise<boolean> {
  try {
    await execAsync("docker info");
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the VNC endpoint to be ready.
 * Polls the HTTP endpoint until it responds or times out.
 *
 * @param port - The port to check
 * @param timeoutMs - Maximum time to wait (default: 15 seconds)
 * @returns true if endpoint is ready, false if timeout
 */
export async function waitForVncReady(
  port: number,
  timeoutMs: number = 15000,
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to fetch the noVNC page - if it responds, VNC is ready
      const response = await fetch(`http://localhost:${port}/`, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok || response.status === 401) {
        // 401 is OK - means server is up but may require auth
        return true;
      }
    } catch {
      // Connection refused or timeout - keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}
