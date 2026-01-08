import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

type ChartType = "bar" | "line" | "area" | "pie";

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

interface ChartRendererProps {
  data: DataPoint[];
  metadata: ChartMetadata;
  chartType: ChartType;
}

// Format currency values
function formatValue(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value}`;
}

// Format percentage values
function formatPercent(value: number): string {
  return `${value}%`;
}

export function ChartRenderer({
  data,
  metadata,
  chartType,
}: ChartRendererProps) {
  const { xKey, series, colors } = metadata;
  const isPie = chartType === "pie";

  // For pie charts, use the name field and add colors from data if available
  const pieColors =
    data[0]?.color !== undefined
      ? data.map((d) => d.color as string)
      : series.map((s) => colors[s] ?? "#64748b");

  if (isPie) {
    return (
      <ResponsiveContainer width="100%" height={350}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={120}
            label={({ name, percent }) =>
              `${name}: ${(percent * 100).toFixed(0)}%`
            }
            labelLine={true}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  (entry.color as string) ?? pieColors[index % pieColors.length]
                }
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => formatPercent(value)}
            contentStyle={{
              backgroundColor: "#1e293b",
              border: "none",
              borderRadius: "6px",
              color: "#f1f5f9",
            }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // Common props for cartesian charts
  const chartContent = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
      <XAxis dataKey={xKey} stroke="#64748b" fontSize={12} tickLine={false} />
      <YAxis
        stroke="#64748b"
        fontSize={12}
        tickLine={false}
        tickFormatter={formatValue}
      />
      <Tooltip
        formatter={(value: number) => formatValue(value)}
        contentStyle={{
          backgroundColor: "#1e293b",
          border: "none",
          borderRadius: "6px",
          color: "#f1f5f9",
        }}
        labelStyle={{ color: "#94a3b8" }}
      />
      <Legend />
    </>
  );

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={350}>
        <BarChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          {chartContent}
          {series.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[key] ?? "#64748b"}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={350}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          {chartContent}
          {series.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[key] ?? "#64748b"}
              strokeWidth={2}
              dot={{ fill: colors[key] ?? "#64748b", strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Area chart
  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        {chartContent}
        {series.map((key) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={colors[key] ?? "#64748b"}
            fill={colors[key] ?? "#64748b"}
            fillOpacity={0.3}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
