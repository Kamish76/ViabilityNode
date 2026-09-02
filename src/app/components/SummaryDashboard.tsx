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

export function SummaryDashboard({ 
  data,
  viabilityStatus,
  plantType 
}: { 
  data: DailySummaryData;
  viabilityStatus?: "optimal" | "warning" | "critical" | "monitoring" | null;
  plantType?: string | null;
}) {
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
        <div className="mt-4 md:mt-0 flex items-center gap-2">
          {viabilityStatus ? (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${
              viabilityStatus === 'optimal' ? 'bg-emerald-500/10 border-emerald-500/20' :
              viabilityStatus === 'warning' ? 'bg-orange-500/10 border-orange-500/20' :
              viabilityStatus === 'critical' ? 'bg-red-500/10 border-red-500/20' :
              'bg-zinc-800/60 border-zinc-700/40'
            }`}>
              <div className={`w-2 h-2 rounded-full animate-pulse ${
                viabilityStatus === 'optimal' ? 'bg-emerald-500' :
                viabilityStatus === 'warning' ? 'bg-orange-500' :
                viabilityStatus === 'critical' ? 'bg-red-500' :
                'bg-zinc-500'
              }`} />
              <span className={`text-sm font-semibold tracking-wide ${
                viabilityStatus === 'optimal' ? 'text-emerald-400' :
                viabilityStatus === 'warning' ? 'text-orange-400' :
                viabilityStatus === 'critical' ? 'text-red-400' :
                'text-zinc-400'
              }`}>
                {viabilityStatus === 'optimal' ? `Optimal for ${plantType || 'Plant'}` :
                 viabilityStatus === 'warning' ? `At Risk (${plantType || 'Plant'})` :
                 viabilityStatus === 'critical' ? `Critical Threat (${plantType || 'Plant'})` :
                 'Monitoring Environment'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium text-emerald-400">Environment Active</span>
            </div>
          )}
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

      {/* Thrive Checklist */}
      <div className="mt-6 p-6 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl shadow-lg">
        <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <Leaf className="w-4 h-4 text-emerald-400" />
          Optimal Thrive Conditions for <span className="text-emerald-300 capitalize">{plantType || "Standard"}</span>
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(() => {
            const type = plantType || "standard";
            let tempRange = [18, 26];
            let vpdRange = [0.8, 1.2];
            let lightDesc = "Moderate light (> 2000 lx)";
            let lightCondition = (l: number) => l > 2000;
            
            if (type === "succulent") {
              tempRange = [20, 30];
              vpdRange = [1.2, 2.0];
              lightDesc = "High light (> 5000 lx avg)";
              lightCondition = (l) => l > 5000;
            } else if (type === "carnivorous") {
              tempRange = [15, 30];
              vpdRange = [0.5, 1.0];
              lightDesc = "Bright light (> 4000 lx avg)";
              lightCondition = (l) => l > 4000;
            } else if (type === "tropical") {
              tempRange = [22, 28];
              vpdRange = [0.6, 1.0];
              lightDesc = "Medium indirect (> 2000 lx avg)";
              lightCondition = (l) => l > 2000;
            } else if (type === "herb") {
              tempRange = [18, 25];
              vpdRange = [0.8, 1.2];
              lightDesc = "Bright light (> 4000 lx avg)";
              lightCondition = (l) => l > 4000;
            }
            
            const checklist = [
              {
                label: `Temperature: ${tempRange[0]}°C – ${tempRange[1]}°C`,
                met: data.current ? data.current.temp >= tempRange[0] && data.current.temp <= tempRange[1] : false,
                value: data.current ? `${data.current.temp.toFixed(1)}°C` : '-'
              },
              {
                label: `VPD: ${vpdRange[0]} – ${vpdRange[1]} kPa`,
                met: data.current ? data.current.vpd >= vpdRange[0] && data.current.vpd <= vpdRange[1] : false,
                value: data.current ? `${data.current.vpd.toFixed(2)} kPa` : '-'
              },
              {
                label: lightDesc,
                met: data.current ? lightCondition(data.current.light) : false,
                value: data.current ? `${Math.round(data.current.light)} lx` : '-'
              }
            ];

            return checklist.map((item, i) => (
              <div key={i} className={`p-4 rounded-2xl border flex items-start gap-3 transition-colors ${
                item.met 
                  ? "bg-emerald-500/5 border-emerald-500/20" 
                  : "bg-zinc-800/40 border-zinc-700/50"
              }`}>
                <div className={`mt-0.5 shrink-0 ${item.met ? "text-emerald-400" : "text-zinc-600"}`}>
                  {item.met ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${item.met ? "text-emerald-100" : "text-zinc-400"}`}>
                    {item.label}
                  </p>
                  <p className={`text-xs mt-1 ${item.met ? "text-emerald-400/80" : "text-zinc-500"}`}>
                    Current: <span className="font-mono">{item.value}</span>
                  </p>
                </div>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
