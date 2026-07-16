import type { ReactNode } from "react";

type StatusPillProps = {
  tone?: "success" | "warning" | "danger" | "neutral" | "info";
  children: ReactNode;
};

export function StatusPill({ tone = "neutral", children }: StatusPillProps) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}
