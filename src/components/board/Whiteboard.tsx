"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Eraser,
  Highlighter,
  LocateFixed,
  Maximize2,
  MousePointer2,
  PenLine,
  Redo2,
  Trash,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { BoardItem } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import type { Stroke } from "@/lib/lesson/types";
import { cn, isTyping } from "@/lib/utils";
import { BoardItemView, isHalf } from "./BoardItemView";
import { InkLayer, type InkAction, type InkTool } from "./InkLayer";
import { BOARD_PAD_X, BOARD_PAD_Y, BOARD_WIDTH, COMPACT_WIDTH } from "./metrics";
import { vars, ms } from "./text-items";

export interface BoardEntry {
  key: string;
  item: BoardItem;
  timing: ItemTiming | null;
}

const PEN_COLORS = ["#f4f2ea", "#ffd166", "#74b9ff", "#7ee2a8", "#ff8080", "#ff9ad5"];

export function Whiteboard({
  entries,
  paused,
  pointedId,
  ink,
  onInkChange,
  selectedKey,
  onSelect,
  pageKey,
  empty,
  overlay,
  corner,
}: {
  entries: BoardEntry[];
  paused: boolean;
  pointedId?: string | null;
  ink: Stroke[];
  onInkChange: (strokes: Stroke[]) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  pageKey: string;
  empty?: ReactNode;
  overlay?: ReactNode;
  corner?: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 900, h: 600 });
  const [pageH, setPageH] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<InkTool>("select");
  const [color, setColor] = useState(PEN_COLORS[1]);
  const [follow, setFollow] = useState(true);
  const undo = useRef<InkAction[]>([]);
  const redo = useRef<InkAction[]>([]);
  const [, bump] = useState(0);

  // Reset ink history when the page changes.
  useEffect(() => {
    undo.current = [];
    redo.current = [];
    bump((n) => n + 1);
  }, [pageKey]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPageH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Phones get a narrower single-column board so the chalk stays readable.
  const compact = vp.w < 700;
  const boardW = compact ? COMPACT_WIDTH : BOARD_WIDTH;
  const padX = compact ? 22 : BOARD_PAD_X;
  const fit = Math.max(0.3, Math.min(1.35, (vp.w - 24) / boardW));
  const scale = fit * zoom;
  const minPageH = Math.ceil(vp.h / scale);

  const apply = useCallback(
    (a: InkAction, record = true) => {
      if (a.kind === "add") onInkChange([...ink, ...a.strokes]);
      else {
        const ids = new Set(a.strokes.map((s) => s.id));
        onInkChange(ink.filter((s) => !ids.has(s.id)));
      }
      if (record) {
        undo.current.push(a);
        redo.current = [];
        bump((n) => n + 1);
      }
    },
    [ink, onInkChange],
  );

  const invert = (a: InkAction): InkAction => ({ kind: a.kind === "add" ? "remove" : "add", strokes: a.strokes });
  const doUndo = useCallback(() => {
    const a = undo.current.pop();
    if (!a) return;
    redo.current.push(a);
    apply(invert(a), false);
    bump((n) => n + 1);
  }, [apply]);
  const doRedo = useCallback(() => {
    const a = redo.current.pop();
    if (!a) return;
    undo.current.push(a);
    apply(a, false);
    bump((n) => n + 1);
  }, [apply]);
  const clearInk = () => {
    if (ink.length) apply({ kind: "remove", strokes: ink });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        doRedo();
      } else if (!mod && !e.altKey) {
        const map: Record<string, InkTool> = { v: "select", p: "pen", h: "highlighter", e: "eraser" };
        if (map[e.key]) setTool(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  // Follow the pen: bring each new item into view as the teacher starts drawing it.
  const animatingKeys = entries.filter((e) => e.timing).map((e) => `${e.key}@${e.timing!.start}`).join("|");
  useEffect(() => {
    if (!follow) return;
    const timers = entries
      .filter((e) => e.timing)
      .map((e) =>
        window.setTimeout(() => {
          const el = viewportRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(e.key)}"]`);
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, e.timing!.start + 30),
      );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animatingKeys, follow]);

  const rows = useMemo(() => entries.map((e) => ({ ...e, half: !compact && isHalf(e.item) })), [entries, compact]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line board-surface">
      {/* toolbar strip: tools on the left, page navigation on the right */}
      <div className="no-print relative z-20 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface/70 px-2 py-1.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolBtn label="Select & ask (V)" active={tool === "select"} onClick={() => setTool("select")}>
          <MousePointer2 size={16} />
        </ToolBtn>
        <ToolBtn label="Pen (P)" active={tool === "pen"} onClick={() => setTool("pen")}>
          <PenLine size={16} />
        </ToolBtn>
        <ToolBtn label="Highlighter (H)" active={tool === "highlighter"} onClick={() => setTool("highlighter")}>
          <Highlighter size={16} />
        </ToolBtn>
        <ToolBtn label="Eraser (E)" active={tool === "eraser"} onClick={() => setTool("eraser")}>
          <Eraser size={16} />
        </ToolBtn>
        {tool === "pen" && (
          <div className="mx-1 flex items-center gap-1">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Pen colour ${c}`}
                onClick={() => setColor(c)}
                className={cn("h-5 w-5 rounded-full border-2 transition", color === c ? "border-white scale-110" : "border-transparent")}
                style={{ background: c }}
              />
            ))}
          </div>
        )}
        <Divider />
        <ToolBtn label="Undo (Ctrl+Z)" disabled={!undo.current.length} onClick={doUndo}>
          <Undo2 size={16} />
        </ToolBtn>
        <ToolBtn label="Redo (Ctrl+Y)" disabled={!redo.current.length} onClick={doRedo}>
          <Redo2 size={16} />
        </ToolBtn>
        <ToolBtn label="Clear my drawings" disabled={!ink.length} onClick={clearInk}>
          <Trash size={16} />
        </ToolBtn>
        <Divider />
        <ToolBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}>
          <ZoomOut size={16} />
        </ToolBtn>
        <button
          className="min-w-12 rounded-md px-1 text-xs tabular-nums text-muted hover:text-fg"
          title="Fit to width"
          onClick={() => setZoom(1)}
        >
          {Math.round(scale * 100)}%
        </button>
        <ToolBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}>
          <ZoomIn size={16} />
        </ToolBtn>
        <ToolBtn label="Fit to width" onClick={() => setZoom(1)}>
          <Maximize2 size={15} />
        </ToolBtn>
        <ToolBtn label={follow ? "Following the teacher's pen" : "Follow the teacher's pen"} active={follow} onClick={() => setFollow((f) => !f)}>
          <LocateFixed size={16} />
        </ToolBtn>
      </div>
      {corner && <div className="ml-auto">{corner}</div>}
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
        <div style={{ width: boardW * scale, height: Math.max(pageH, minPageH) * scale, margin: "0 auto" }}>
          <div
            ref={pageRef}
            className={cn("board-page relative", paused && "board-paused")}
            style={{
              width: boardW,
              minHeight: minPageH,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
              padding: `${BOARD_PAD_Y}px ${padX}px ${BOARD_PAD_Y + 120}px`,
            }}
            onClick={(e) => {
              if (tool === "select" && e.target === e.currentTarget) onSelect(null);
            }}
          >
            <div className="b-grid">
              {rows.map((e) => {
                const pointed = !!pointedId && e.item.id === pointedId;
                return (
                  <div
                    key={e.key}
                    data-key={e.key}
                    className={cn(
                      "b-cell",
                      e.half && "half",
                      e.timing && "anim",
                      pointed && "pointed",
                      tool === "select" && "selectable",
                      selectedKey === e.key && "selected",
                    )}
                    style={e.timing ? vars({ "--start": ms(e.timing.start), "--dur": ms(e.timing.dur) }) : undefined}
                    onClick={(ev) => {
                      if (tool !== "select") return;
                      ev.stopPropagation();
                      onSelect(selectedKey === e.key ? null : e.key);
                    }}
                  >
                    <BoardItemView item={e.item} timing={e.timing} width={compact ? boardW - padX * 2 : undefined} />
                  </div>
                );
              })}
            </div>
            {!entries.length && empty && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ fontFamily: "var(--font-sans)" }}>
                {empty}
              </div>
            )}
            <InkLayer
              strokes={ink}
              tool={tool}
              color={color}
              scale={scale}
              onAction={(a) => apply(a)}
            />
          </div>
        </div>
      </div>
      {overlay}
    </div>
  );
}

function ToolBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg transition",
        active ? "bg-accent/25 text-accent-strong" : "text-muted hover:bg-white/5 hover:text-fg",
        disabled && "pointer-events-none opacity-35",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-line-strong" />;
