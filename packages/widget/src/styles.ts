import type { CSSProperties } from "react";

/**
 * Inline styles rather than a stylesheet.
 *
 * The widget is dropped into other people's pages. Shipping a CSS file would
 * require the host to import it, and global class names would collide with
 * theirs. Inline styles are self-contained and cannot leak either way.
 */
const border = "#2a2a2e";
const surface = "#141417";
const text = "#f4f4f5";
const muted = "#8b8b93";

export const styles = {
  card: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 360,
    padding: 16,
    borderRadius: 12,
    border: `1px solid ${border}`,
    background: surface,
    color: text,
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontSize: 14,
    lineHeight: 1.45,
  },
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  symbol: { fontSize: 18, fontWeight: 600 },
  pillRow: { display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" },
  pill: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  pillLive: { background: "rgba(16,185,129,0.15)", color: "#6ee7b7" },
  pillPending: { background: "rgba(14,165,233,0.15)", color: "#7dd3fc" },
  pillEnded: { background: "rgba(113,113,122,0.18)", color: "#c4c4cc" },
  pillGraduated: { background: "rgba(139,92,246,0.18)", color: "#c4b5fd" },

  priceBlock: { marginTop: 14 },
  price: { fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", wordBreak: "break-all" },
  priceUnit: { fontSize: 12, fontWeight: 400, color: muted },

  grid: { margin: "14px 0 0", display: "grid", gap: 8 },
  row: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, margin: 0 },
  label: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: muted, margin: 0 },
  value: { margin: 0, fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums" },

  form: { marginTop: 16, display: "grid", gap: 6, borderTop: `1px solid ${border}`, paddingTop: 14 },
  input: {
    boxSizing: "border-box",
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: "#0d0d0f",
    color: text,
    fontSize: 14,
    outline: "none",
  },
  button: {
    marginTop: 6,
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: text,
    color: "#0d0d0f",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonDisabled: {
    background: "#2a2a2e",
    color: muted,
    cursor: "not-allowed",
  },
  notice: {
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(113,113,122,0.12)",
    color: muted,
    fontSize: 12,
  },
  muted: { color: muted, fontSize: 12 },
  error: { color: "#fca5a5", fontSize: 12, wordBreak: "break-word" },
  success: { color: "#6ee7b7", fontSize: 12, wordBreak: "break-word" },
  link: { color: "#7dd3fc" },
  footer: {
    marginTop: 14,
    paddingTop: 10,
    borderTop: `1px solid ${border}`,
    color: muted,
    fontSize: 11,
    textAlign: "center",
  },
} satisfies Record<string, CSSProperties>;
