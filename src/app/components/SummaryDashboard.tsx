import { TrendingUp, TrendingDown, Minus, Thermometer, Droplets, Wind, Sun, Leaf } from "lucide-react";

export interface DaySummary {
  temp: number;
  humidity: number;
  vpd: number;
  light: number;
  moistureRaw: number;
}

export interface DailySummaryData {
  current: DaySummary | null;
  previous: DaySummary | null;
}

export function SummaryDashboard({ data }: { data: DailySummaryData }) {
  if (!data.current) return null;

  const calculateTrend = (current: number, previous: number | null) => {
    if (previous === null) return null;
    const diff = current - previous;
    // Assume a small threshold to be considered "stable"
    if (Math.abs(diff) < 0.1) return "stable";
    return diff > 0 ? "up" : "down";
  };

  const getTrendIcon = (trend: string | null) => {
    if (trend === "up") return <TrendingUp className="w-4 h-4 text-orange-400" />;
    if (trend === "down") return <TrendingDown className="w-4 h-4 text-blue-400" />;
    if (trend === "stable") return <Minus className="w-4 h-4 text-zinc-500" />;
    return null;
  };

  const metrics = [
    {
      label: "Avg Temp",
      value: `${data.current.temp.toFixed(1)}°C`,
      trend: calculateTrend(data.current.temp, data.previous?.temp ?? null),
      icon: <Thermometer className="w-5 h-5 text-orange-400" />,
      desc: "Daily average",
    },
    {
      label: "Avg Humidity",
      value: `${data.current.humidity.toFixed(1)}%`,
      trend: calculateTrend(data.current.humidity, data.previous?.humidity ?? null),
      icon: <Droplets className="w-5 h-5 text-blue-400" />,
      desc: "Daily average",
    },
    {
      label: "Avg VPD",
      value: `${data.current.vpd.toFixed(2)} kPa`,
      trend: calculateTrend(data.current.vpd, data.previous?.vpd ?? null),
      icon: <Wind className="w-5 h-5 text-teal-400" />,
      desc: "Vapor Pressure Deficit",
    },
    {
      label: "Avg Light",
      value: `${Math.round(data.current.light)} lx`,
      trend: calculateTrend(data.current.light, data.previous?.light ?? null),
      icon: <Sun className="w-5 h-5 text-yellow-400" />,
      desc: "Illuminance",
    },
    {
      label: "Avg Moisture",
      value: data.current.moistureRaw.toFixed(0),
      trend: calculateTrend(data.current.moistureRaw, data.previous?.moistureRaw ?? null),
      icon: <Leaf className="w-5 h-5 text-emerald-400" />,
      desc: "Raw ADC",
    },
  ];

  return (
    <div id="summary" className="mb-12 scroll-mt-24">
      <div className="flex flex-col md:flex-row items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            Climate Status
          </h2>
          <p className="text-zinc-400 text-sm mt-1">
            Current day averages vs. previous day
          </p>
        </div>
        <div className="mt-4 md:mt-0 flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-medium text-emerald-400">Environment Active</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {metrics.map((m, idx) => (
          <div
            key={idx}
            className="group relative overflow-hidden p-5 rounded-3xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur-xl hover:bg-zinc-800/80 transition-all duration-300 shadow-lg"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="relative z-10 flex flex-col h-full justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-zinc-800/50 rounded-xl group-hover:scale-110 transition-transform duration-300">
                  {m.icon}
                </div>
                {m.trend && (
                  <div className="flex items-center gap-1 text-xs font-medium px-2 py-1 bg-zinc-950/50 rounded-full border border-zinc-800">
                    {getTrendIcon(m.trend)}
                  </div>
                )}
              </div>
              
              <div>
                <span className="text-2xl font-bold text-white tracking-tight block">
                  {m.value}
                </span>
                <span className="text-sm font-medium text-zinc-400 mt-1 block">
                  {m.label}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-600 mt-0.5 block">
                  {m.desc}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
