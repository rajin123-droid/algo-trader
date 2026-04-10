import { NavLink, Outlet } from "react-router-dom";
import { Zap, BarChart2, Layers, GitBranch, Store, Users, ShieldCheck } from "lucide-react";

const NAV = [
  { to: "/",           label: "Trade",       icon: BarChart2   },
  { to: "/portfolio",  label: "Portfolio",   icon: Layers      },
  { to: "/positions",  label: "Positions",   icon: BarChart2   },
  { to: "/strategies", label: "Strategies",  icon: GitBranch   },
  { to: "/marketplace",label: "Marketplace", icon: Store       },
  { to: "/copy",       label: "Copy",        icon: Users       },
  { to: "/admin",      label: "Admin",       icon: ShieldCheck },
] as const;

export default function AppLayout() {
  return (
    <div
      className="flex flex-col font-mono select-none h-full"
      style={{ background: "#0B0E11", color: "#E8E8E8" }}
    >
      <header
        className="flex items-center gap-6 px-4 shrink-0"
        style={{
          height: 44,
          borderBottom: "1px solid #2B3139",
          background: "#0d1117",
        }}
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-yellow-400" />
          <span className="text-sm font-bold tracking-tight" style={{ color: "#F0B90B" }}>
            ALGO_TERMINAL
          </span>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                [
                  "px-3 py-1 text-[11px] rounded transition-colors",
                  isActive
                    ? "text-yellow-400 bg-white/[0.05]"
                    : "text-[#555C6A] hover:text-[#C8C8C8] hover:bg-white/[0.03]",
                ].join(" ")
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
