/**
 * @file System Monitor App - displays real-time OS metrics with Chart.js
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { Chart, registerables } from "chart.js";
import "./global.css";
import "./mcp-app.css";

// Register Chart.js components
Chart.register(...registerables);

// =============================================================================
// Types
// =============================================================================

// Static system info (received once via ontoolresult from LLM-facing tool)
interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  cpu: {
    model: string;
    count: number;
  };
  memory: {
    totalBytes: number;
  };
}

// Dynamic polling data (received repeatedly via poll-system-stats)
interface PollStats {
  cpu: {
    cores: Array<{ idle: number; total: number }>;
  };
  memory: {
    usedBytes: number;
    usedPercent: number;
    freeBytes: number;
  };
  uptime: {
    seconds: number;
  };
  timestamp: string;
}

interface AppState {
  // Static info (set once via ontoolresult)
  systemInfo: SystemInfo | null;
  // Polling state
  isPolling: boolean;
  intervalId: number | null;
  cpuHistory: number[][]; // [timestamp][coreIndex] = usage%
  labels: string[];
  chart: Chart | null;
  previousCpuSnapshots: Array<{ idle: number; total: number }> | null;
}

// =============================================================================
// DOM References
// =============================================================================

const mainEl = document.querySelector(".main") as HTMLElement;
const pollToggleBtn = document.getElementById("poll-toggle-btn")!;
const statusIndicator = document.getElementById("status-indicator")!;
const statusText = document.getElementById("status-text")!;
const cpuChartCanvas = document.getElementById(
  "cpu-chart",
) as HTMLCanvasElement;
const memoryBarFill = document.getElementById("memory-bar-fill")!;
const memoryPercent = document.getElementById("memory-percent")!;
const memoryDetail = document.getElementById("memory-detail")!;
const infoHostname = document.getElementById("info-hostname")!;
const infoPlatform = document.getElementById("info-platform")!;
const infoUptime = document.getElementById("info-uptime")!;

// =============================================================================
// Constants & State
// =============================================================================

const HISTORY_LENGTH = 30;
const POLL_INTERVAL = 2000;

// Color palette for CPU cores (distinct colors)
const CORE_COLORS = [
  "rgba(59, 130, 246, 0.7)", // blue
  "rgba(16, 185, 129, 0.7)", // green
  "rgba(245, 158, 11, 0.7)", // amber
  "rgba(239, 68, 68, 0.7)", // red
  "rgba(139, 92, 246, 0.7)", // purple
  "rgba(236, 72, 153, 0.7)", // pink
  "rgba(20, 184, 166, 0.7)", // teal
  "rgba(249, 115, 22, 0.7)", // orange
  "rgba(34, 197, 94, 0.7)", // emerald
  "rgba(168, 85, 247, 0.7)", // violet
  "rgba(251, 146, 60, 0.7)", // orange-light
  "rgba(74, 222, 128, 0.7)", // green-light
  "rgba(96, 165, 250, 0.7)", // blue-light
  "rgba(248, 113, 113, 0.7)", // red-light
  "rgba(167, 139, 250, 0.7)", // purple-light
  "rgba(244, 114, 182, 0.7)", // pink-light
];

const state: AppState = {
  systemInfo: null,
  isPolling: false,
  intervalId: null,
  cpuHistory: [],
  labels: [],
  chart: null,
  previousCpuSnapshots: null,
};

// =============================================================================
// Formatting Utilities
// =============================================================================

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "< 1m";
}

// =============================================================================
// Chart.js Setup
// =============================================================================

function initChart(coreCount: number): Chart {
  const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const textColor = isDarkMode ? "#9ca3af" : "#6b7280";
  const gridColor = isDarkMode ? "#374151" : "#e5e7eb";

  const datasets = Array.from({ length: coreCount }, (_, i) => ({
    label: `P${i}`,
    data: [] as number[],
    fill: true,
    backgroundColor: CORE_COLORS[i % CORE_COLORS.length],
    borderColor: CORE_COLORS[i % CORE_COLORS.length].replace("0.7", "1"),
    borderWidth: 1,
    pointRadius: 0,
    tension: 0.3,
  }));

  return new Chart(cpuChartCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 300,
      },
      interaction: {
        intersect: false,
        mode: "index",
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            boxWidth: 12,
            padding: 8,
            font: { size: 10 },
            color: textColor,
          },
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (context) =>
              `${context.dataset.label}: ${context.parsed.y}%`,
          },
        },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          stacked: true,
          min: 0,
          max: coreCount * 100,
          ticks: {
            callback: (value) => `${value}%`,
            color: textColor,
            font: { size: 10 },
          },
          grid: {
            color: gridColor,
          },
        },
      },
    },
  });
}

function updateChart(
  cpuHistory: number[][],
  labels: string[],
  coreCount: number,
): void {
  if (!state.chart) return;

  state.chart.data.labels = labels;

  // Transpose: cpuHistory[time][core] -> datasets[core].data[time]
  for (let coreIdx = 0; coreIdx < coreCount; coreIdx++) {
    state.chart.data.datasets[coreIdx].data = cpuHistory.map(
      (snapshot) => snapshot[coreIdx] ?? 0,
    );
  }

  // Dynamic y-axis scaling
  // Calculate max stacked value (sum of all cores at each time point)
  const stackedTotals = cpuHistory.map((snapshot) =>
    snapshot.reduce((sum, val) => sum + val, 0),
  );
  const currentMax = Math.max(...stackedTotals, 0);

  // Add 20% headroom, clamp to reasonable bounds
  const headroom = 1.2;
  const minVisible = coreCount * 15; // At least 15% per core visible
  const absoluteMax = coreCount * 100;

  const dynamicMax = Math.min(
    Math.max(currentMax * headroom, minVisible),
    absoluteMax,
  );

  state.chart.options.scales!.y!.max = dynamicMax;

  state.chart.update("none");
}

// =============================================================================
// UI Updates
// =============================================================================

function updateMemoryBar(
  memory: PollStats["memory"],
  totalBytes: number,
): void {
  const percent = memory.usedPercent;

  memoryBarFill.style.width = `${percent}%`;
  memoryBarFill.classList.remove("warning", "danger");

  if (percent >= 80) {
    memoryBarFill.classList.add("danger");
  } else if (percent >= 60) {
    memoryBarFill.classList.add("warning");
  }

  memoryPercent.textContent = `${percent}%`;
  memoryDetail.textContent = `${formatBytes(memory.usedBytes)} / ${formatBytes(totalBytes)}`;
}

// Called once when static system info is received
function updateStaticSystemInfo(info: SystemInfo): void {
  infoHostname.textContent = info.hostname;
  infoPlatform.textContent = info.platform;
}

// Called on each poll for dynamic uptime
function updateDynamicUptime(uptime: PollStats["uptime"]): void {
  infoUptime.textContent = formatUptime(uptime.seconds);
}

function updateStatus(text: string, isPolling = false, isError = false): void {
  statusText.textContent = text;
  statusIndicator.classList.remove("polling", "error");

  if (isError) {
    statusIndicator.classList.add("error");
  } else if (isPolling) {
    statusIndicator.classList.add("polling");
  }
}

// =============================================================================
// MCP App & Data Fetching
// =============================================================================

const app = new App({ name: "System Monitor", version: "1.0.0" });

function calculateCpuUsage(
  current: Array<{ idle: number; total: number }>,
  previous: Array<{ idle: number; total: number }> | null,
): number[] {
  if (!previous || previous.length !== current.length) {
    return current.map(() => 0);
  }
  return current.map((cur, i) => {
    const prev = previous[i];
    const idleDiff = cur.idle - prev.idle;
    const totalDiff = cur.total - prev.total;
    if (totalDiff === 0) return 0;
    return Math.round((1 - idleDiff / totalDiff) * 100);
  });
}

async function fetchStats(): Promise<void> {
  // systemInfo is guaranteed to exist (polling starts after ontoolresult)
  const { systemInfo } = state;
  if (!systemInfo) return;

  try {
    const result = await app.callServerTool({
      name: "poll-system-stats", // App-only tool for polling dynamic data
      arguments: {},
    });

    const stats = result.structuredContent as unknown as PollStats;
    const coreCount = systemInfo.cpu.count;

    // Calculate CPU usage from raw timing data (client-side)
    const coreUsages = calculateCpuUsage(
      stats.cpu.cores,
      state.previousCpuSnapshots,
    );
    state.previousCpuSnapshots = stats.cpu.cores;
    state.cpuHistory.push(coreUsages);
    state.labels.push(new Date().toLocaleTimeString());

    // Trim to window size
    if (state.cpuHistory.length > HISTORY_LENGTH) {
      state.cpuHistory.shift();
      state.labels.shift();
    }

    // Update UI with dynamic data
    updateChart(state.cpuHistory, state.labels, coreCount);
    updateMemoryBar(stats.memory, systemInfo.memory.totalBytes);
    updateDynamicUptime(stats.uptime);

    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    updateStatus(time, true);
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    updateStatus("Error", false, true);
  }
}

// =============================================================================
// Polling Control
// =============================================================================

function startPolling(): void {
  if (state.isPolling) return;

  state.isPolling = true;
  pollToggleBtn.textContent = "Stop";
  pollToggleBtn.classList.add("active");
  updateStatus("Starting...", true);

  // Immediate first fetch
  fetchStats();

  // Start interval
  state.intervalId = window.setInterval(fetchStats, POLL_INTERVAL);
}

function stopPolling(): void {
  if (!state.isPolling) return;

  state.isPolling = false;
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  pollToggleBtn.textContent = "Start";
  pollToggleBtn.classList.remove("active");
  updateStatus("Stopped");
}

function togglePolling(): void {
  if (state.isPolling) {
    stopPolling();
  } else {
    startPolling();
  }
}

// =============================================================================
// Event Handlers & Initialization
// =============================================================================

pollToggleBtn.addEventListener("click", togglePolling);

// Handle theme changes
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (state.chart && state.systemInfo) {
      const coreCount = state.systemInfo.cpu.count;
      state.chart.destroy();
      state.chart = initChart(coreCount);
      updateChart(state.cpuHistory, state.labels, coreCount);
    }
  });

app.onerror = console.error;

// Receive static system info when host sends the initial tool result
app.ontoolresult = (result) => {
  const info = result.structuredContent as unknown as SystemInfo;

  if (info) {
    state.systemInfo = info;

    // Initialize chart with CPU count from static info
    state.chart = initChart(info.cpu.count);

    // Update static UI elements (hostname, platform)
    updateStaticSystemInfo(info);

    // Start polling after receiving static info
    startPolling();
  }
};

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

app.onhostcontextchanged = handleHostContextChanged;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
