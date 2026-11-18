import type { T } from "./i18n";

export function timeAgo(iso: string, t: T = (s, v) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v?.[k] ?? ""))): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("just now");
  const m = Math.round(s / 60);
  if (m < 60) return t("{n} min ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n} h ago", { n: h });
  const d = Math.round(h / 24);
  if (d < 30) return t("{n} d ago", { n: d });
  return new Date(iso).toLocaleDateString();
}

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
