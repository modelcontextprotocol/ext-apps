import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ChartRenderer } from "./components/ChartRenderer.tsx";
import "./global.css";
import "./mcp-app.css";

// Types
type ChartType = "bar" | "line" | "area" | "pie";
type DatasetId = "monthly-revenue" | "quarterly-sales" | "product-mix";

interface DataPoint {
  [key: string]: string | number;
}

interface ChartMetadata {
  title: string;
  description: string;
  xKey: string;
  series: string[];
  colors: Record<string, string>;
  defaultChartType: ChartType;
  supportedChartTypes: ChartType[];
}

interface ChartData {
  datasetId: DatasetId;
  chartType: ChartType;
  data: DataPoint[];
  metadata: ChartMetadata;
}

const APP_INFO = { name: "Recharts Dashboard", version: "1.0.0" };

// Dataset options for the selector
const DATASET_OPTIONS: { id: DatasetId; label: string }[] = [
  { id: "monthly-revenue", label: "Monthly Revenue" },
  { id: "quarterly-sales", label: "Quarterly Sales by Region" },
  { id: "product-mix", label: "Product Mix" },
];

// Extract chart data from tool result
function extractChartData(result: CallToolResult): ChartData | null {
  const textContent = result.content?.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") return null;
  try {
    return JSON.parse(textContent.text) as ChartData;
  } catch {
    console.error("[APP] Failed to parse chart data");
    return null;
  }
}

function RechartsDashboard() {
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [selectedDataset, setSelectedDataset] =
    useState<DatasetId>("monthly-revenue");
  const [selectedChartType, setSelectedChartType] = useState<ChartType>("bar");

  const { app, error } = useApp({
    appInfo: APP_INFO,
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = async (result) => {
        const data = extractChartData(result);
        if (data) {
          setChartData(data);
          setSelectedDataset(data.datasetId);
          setSelectedChartType(data.chartType);
        }
      };
    },
  });

  const handleDatasetChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const datasetId = e.target.value as DatasetId;
      setSelectedDataset(datasetId);
      if (app) {
        try {
          await app.callServerTool({
            name: "get-chart-data",
            arguments: { datasetId },
          });
        } catch (err) {
          console.error("[APP] Failed to load dataset:", err);
        }
      }
    },
    [app],
  );

  const handleChartTypeChange = useCallback(
    async (chartType: ChartType) => {
      // Check if chart type is supported
      if (
        chartData &&
        !chartData.metadata.supportedChartTypes.includes(chartType)
      ) {
        return;
      }
      setSelectedChartType(chartType);
      if (app) {
        try {
          await app.callServerTool({
            name: "get-chart-data",
            arguments: { datasetId: selectedDataset, chartType },
          });
        } catch (err) {
          console.error("[APP] Failed to change chart type:", err);
        }
      }
    },
    [app, selectedDataset, chartData],
  );

  if (error) {
    return (
      <main className="main">
        <div className="error">Error: {error.message}</div>
      </main>
    );
  }

  if (!app) {
    return (
      <main className="main">
        <div className="loading">Connecting...</div>
      </main>
    );
  }

  const supportedTypes = chartData?.metadata.supportedChartTypes ?? [
    "bar",
    "line",
    "area",
    "pie",
  ];

  return (
    <main className="main">
      <header className="header">
        <h1 className="header-title">Recharts Dashboard</h1>
        <div className="controls">
          <select value={selectedDataset} onChange={handleDatasetChange}>
            {DATASET_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          {(["bar", "line", "area", "pie"] as ChartType[]).map((type) => (
            <button
              key={type}
              className={selectedChartType === type ? "active" : ""}
              onClick={() => handleChartTypeChange(type)}
              disabled={!supportedTypes.includes(type)}
              title={
                supportedTypes.includes(type)
                  ? `Switch to ${type} chart`
                  : `${type} chart not available for this dataset`
              }
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div className="chart-container">
        {chartData ? (
          <>
            <h2 className="chart-title">{chartData.metadata.title}</h2>
            <p className="chart-description">
              {chartData.metadata.description}
            </p>
            <ChartRenderer
              data={chartData.data}
              metadata={chartData.metadata}
              chartType={selectedChartType}
            />
          </>
        ) : (
          <div className="loading">Loading chart data...</div>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RechartsDashboard />
  </StrictMode>,
);
