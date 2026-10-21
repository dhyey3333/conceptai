"use client";

import { memo } from "react";
import type { BoardItem } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import { cellWidth } from "./metrics";
import { BulletsItem, MathItem, StepsItem, TableItem, TextItem, TitleItem } from "./text-items";
import { FigureItem } from "./FigureItem";
import { PlotItem } from "./PlotItem";
import { FlowchartItem } from "./FlowchartItem";
import { TreeItem } from "./TreeItem";
import { ArrayItem } from "./ArrayItem";

/** Whether an item takes half the board width (so another can sit beside it). */
export function isHalf(item: BoardItem): boolean {
  if (item.type === "title" || item.type === "heading") return false;
  if ("size" in item && item.size) return item.size === "half";
  return false;
}

/** Renders one board item. `timing` = animate now; null = already on the board. */
export const BoardItemView = memo(function BoardItemView({
  item,
  timing,
  width,
}: {
  item: BoardItem;
  timing: ItemTiming | null;
  /** px width available; defaults to the board cell width */
  width?: number;
}) {
  const w = width ?? cellWidth(isHalf(item));
  switch (item.type) {
    case "title":
    case "heading":
      return <TitleItem item={item} timing={timing} kind={item.type} />;
    case "text":
      return <TextItem item={item} timing={timing} width={w} />;
    case "bullets":
      return <BulletsItem item={item} timing={timing} />;
    case "math":
      return <MathItem item={item} timing={timing} />;
    case "steps":
      return <StepsItem item={item} timing={timing} />;
    case "table":
      return <TableItem item={item} timing={timing} />;
    case "figure":
      return <FigureItem item={item} timing={timing} width={w} />;
    case "plot":
      return <PlotItem item={item} timing={timing} width={w} />;
    case "flowchart":
      return <FlowchartItem item={item} timing={timing} width={w} />;
    case "tree":
      return <TreeItem item={item} timing={timing} width={w} />;
    case "array":
      return <ArrayItem item={item} timing={timing} width={w} />;
  }
});
