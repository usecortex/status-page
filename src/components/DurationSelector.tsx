"use client";

import { DurationDays } from "@/types/status";

interface DurationSelectorProps {
  selected: DurationDays;
  onChange: (d: DurationDays) => void;
}

const OPTIONS: DurationDays[] = [30, 60, 90];

export default function DurationSelector({ selected, onChange }: DurationSelectorProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
      }}
    >
      {OPTIONS.map((d) => {
        const isActive = d === selected;
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            style={{
              padding: "6px 16px",
              borderRadius: "6px",
              border: isActive ? "1px solid var(--border)" : "1px solid transparent",
              backgroundColor: isActive ? "var(--ui-1)" : "transparent",
              color: isActive ? "var(--text)" : "var(--text-40)",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: isActive ? 600 : 400,
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            {d} days
          </button>
        );
      })}
    </div>
  );
}
