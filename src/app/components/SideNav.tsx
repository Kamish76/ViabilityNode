"use client";

import { useEffect, useState } from "react";
import { LayoutDashboard, Activity, FlaskConical, LineChart, ListTree } from "lucide-react";

const navItems = [
  { id: "summary", label: "Summary", icon: LayoutDashboard },
  { id: "live-metrics", label: "Live Metrics", icon: Activity },
  { id: "trial-progress", label: "Trial Progress", icon: FlaskConical },
  { id: "analytics", label: "Analytics", icon: LineChart },
  { id: "live-logs", label: "Logs", icon: ListTree },
];

export function SideNav() {
  const [activeId, setActiveId] = useState<string>("summary");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -60% 0px" } // Adjust margins to trigger when mostly in view
    );

    navItems.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      // Offset for header padding if needed
      const y = element.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <nav className="hidden lg:flex flex-col w-64 fixed left-6 top-32 space-y-2 z-40">
        <div className="p-4 rounded-3xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur-xl shadow-2xl">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4 px-3">
            Navigation
          </p>
          <ul className="space-y-2">
            {navItems.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  onClick={(e) => handleClick(e, id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 font-medium ${
                    activeId === id
                      ? "bg-emerald-500/10 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.2)]"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  <Icon className={`w-5 h-5 ${activeId === id ? "text-emerald-400" : "text-zinc-500"}`} />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Mobile Bottom Bar */}
      <nav className="lg:hidden fixed bottom-6 left-6 right-6 z-50">
        <div className="flex items-center justify-between p-2 rounded-full border border-zinc-800/80 bg-zinc-900/80 backdrop-blur-xl shadow-2xl">
          {navItems.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => handleClick(e, id)}
              className={`flex flex-col items-center justify-center p-2 rounded-full transition-all duration-300 w-14 h-14 ${
                activeId === id
                  ? "bg-emerald-500/20 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.2)]"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title={label}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] mt-1 font-medium hidden sm:block">{label}</span>
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}
