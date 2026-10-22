/**
 * Notes on a long document are written block by block, often by different
 * models as the provider chain falls back, and each model picks its own
 * heading levels (one opens with "#", another with "##"). The route writes
 * each block's "## Part k" heading itself and nests whatever the model wrote
 * under it, so the full notes have one consistent outline.
 */

/** Shift every heading so the shallowest one sits at `top` (relative levels kept; code blocks untouched). */
export function nestHeadings(md: string, top: number): string {
  const lines = md.split("\n");
  let fence = false;
  const isHeading = lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    return !fence && /^#{1,6}\s/.test(l);
  });
  const levels = lines.filter((_, i) => isHeading[i]).map((l) => l.match(/^#+/)![0].length);
  if (!levels.length) return md;
  const shift = top - Math.min(...levels);
  if (shift <= 0) return md;
  return lines.map((l, i) => (isHeading[i] ? l.replace(/^#+/, (h) => "#".repeat(Math.min(6, h.length + shift))) : l)).join("\n");
}

/** Drop a part heading the model wrote anyway ("## Part 2: …"), since the route already wrote it. */
export function dropPartHeading(md: string): string {
  return md.replace(/^\s*#{1,6}\s*Part\s+\d+\b[^\n]*\n+/i, "");
}
