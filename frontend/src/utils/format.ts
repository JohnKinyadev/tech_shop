import type { StatusTone } from "../api/types";

export function money(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function integer(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-KE").format(Number(value ?? 0));
}

export function titleize(value: string | null | undefined) {
  return (value ?? "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function dateLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function toneForStatus(status: string | boolean | null | undefined): StatusTone {
  if (typeof status === "boolean") return status ? "success" : "danger";
  const normalized = String(status ?? "").toLowerCase();
  if (
    ["active", "available", "approved", "completed", "paid", "received"].includes(
      normalized,
    )
  ) {
    return "success";
  }
  if (
    ["ready", "ready_for_pickup", "submitted", "partially_received"].includes(
      normalized,
    )
  ) {
    return "info";
  }
  if (
    ["draft", "pending", "diagnosing", "awaiting_parts", "quote_pending"].includes(
      normalized,
    )
  ) {
    return "warning";
  }
  if (["cancelled", "voided", "rejected", "low"].includes(normalized)) {
    return "danger";
  }
  return "neutral";
}
