import type { ReactNode } from "react";

interface ComingSoonProps {
  icon: ReactNode;
  title: string;
  description: string;
  features: string[];
}

export function ComingSoon({ icon, title, description, features }: ComingSoonProps) {
  return (
    <div className="flex items-center justify-center h-full bg-[#0B0E11]">
      <div className="flex flex-col items-center gap-6 max-w-md text-center px-6">
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-bold font-mono mb-2 text-[#E8E8E8]">{title}</h2>
          <p className="text-[13px] text-[#555C6A] leading-relaxed">{description}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 w-full">
          {features.map((f) => (
            <div
              key={f}
              className="px-3 py-2 rounded text-[11px] font-mono text-[#848E9C] text-left"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #2B3139" }}
            >
              — {f}
            </div>
          ))}
        </div>
        <span
          className="text-[10px] font-mono px-3 py-1 rounded-full"
          style={{ background: "rgba(240,185,11,0.1)", color: "#F0B90B", border: "1px solid rgba(240,185,11,0.2)" }}
        >
          COMING SOON
        </span>
      </div>
    </div>
  );
}
