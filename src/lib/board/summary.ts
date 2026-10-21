/** Plain-text descriptions of board items, used as context for follow-up questions. */
import type { BoardItem } from "./schema";

export function summarizeItem(item: BoardItem): string {
  switch (item.type) {
    case "title":
      return `Title: ${item.text}`;
    case "heading":
      return `Heading: ${item.text}`;
    case "text":
      return `${item.tone && item.tone !== "normal" ? item.tone[0].toUpperCase() + item.tone.slice(1) : "Note"}: ${item.text}`;
    case "bullets":
      return `List: ${item.items.join("; ")}`;
    case "math":
      return `Equation${item.label ? ` (${item.label})` : ""}: ${item.latex}`;
    case "steps":
      return `Steps: ${item.lines.map((l) => l.latex + (l.note ? ` [${l.note}]` : "")).join(" → ")}`;
    case "table":
      return `Table [${item.headers.join(" | ")}]: ${item.rows.map((r) => r.join(" | ")).join("; ")}`;
    case "flowchart": {
      const label = new Map(item.nodes.map((n) => [n.id, n.label]));
      const edges = (item.edges ?? []).map((e) => `${label.get(e.from)} → ${label.get(e.to)}${e.label ? ` (${e.label})` : ""}`);
      return `Flowchart: ${edges.length ? edges.join("; ") : item.nodes.map((n) => n.label).join(", ")}`;
    }
    case "figure": {
      const labels = item.shapes
        .map((s) => (s.shape === "text" ? s.text : s.label))
        .filter(Boolean)
        .join(", ");
      return `Figure${item.caption ? `: ${item.caption}` : ""}${labels ? ` (labels: ${labels})` : ""}`;
    }
    case "plot":
      return `Graph of ${(item.functions ?? []).map((f) => f.label ?? f.expr).join(", ") || "data points"} for x in [${item.xMin}, ${item.xMax}]`;
  }
}

export function summarizeItems(items: BoardItem[], maxChars = 2500): string {
  let out = "";
  for (const it of items) {
    const line = "- " + summarizeItem(it) + "\n";
    if (out.length + line.length > maxChars) break;
    out += line;
  }
  return out.trim();
}
