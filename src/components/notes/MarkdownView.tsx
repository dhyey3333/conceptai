"use client";

/**
 * Renders notes Markdown: GFM tables, KaTeX maths, ```mermaid diagrams and
 * ```diagram blocks (one whiteboard item as JSON, drawn by the board renderer).
 * Raw HTML in the Markdown is not rendered (react-markdown's default), mermaid
 * runs with securityLevel "strict", and diagram JSON goes through the same
 * validator as the whiteboard, so model output can't inject markup or scripts.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { sanitizeItem } from "@/lib/board/schema";
import { BoardItemView } from "@/components/board/BoardItemView";
import { extractJsonObject } from "@/lib/stream/jsonObjects";
import { cn } from "@/lib/utils";

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function hastText(n: HastNode | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}

/** Split at "## " headings (outside code fences / display maths) so finished sections don't re-render. */
export function splitSections(md: string): string[] {
  const lines = md.split("\n");
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  let math = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && /^\s*\$\$\s*$/.test(line)) math = !math;
    if (!fence && !math && /^##\s/.test(line) && cur.length) {
      out.push(cur.join("\n"));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  mermaidReady ??= import("mermaid").then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      fontFamily: "var(--font-inter), sans-serif",
      flowchart: { htmlLabels: false },
    });
    return m.default;
  });
  return mermaidReady;
}

let mermaidSeq = 0;

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const id = `mmd-${++mermaidSeq}`;
    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg }) => {
        if (alive && ref.current) {
          ref.current.innerHTML = svg;
          setError(false);
        }
      })
      .catch(() => {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [code]);
  if (error)
    return (
      <figure className="my-4">
        <pre className="text-[12px]">{code}</pre>
        <figcaption className="text-[12px] text-[#9a6b00]">This diagram couldn&apos;t be drawn; showing its source.</figcaption>
      </figure>
    );
  return <div ref={ref} className="my-5 flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full" />;
}

function DiagramBlock({ json }: { json: string }) {
  const item = useMemo(() => sanitizeItem(extractJsonObject(json)), [json]);
  if (!item) return <pre className="text-[12px]">{json}</pre>;
  const width = Math.min(640, item.type === "flowchart" ? 640 : 560);
  return (
    <figure className="paper my-5 flex justify-center">
      <div className="board-page" style={{ width, maxWidth: "100%" }}>
        <BoardItemView item={item} timing={null} width={width} />
      </div>
    </figure>
  );
}

function makeComponents(streaming: boolean): Components {
  return {
    pre({ node, children }) {
      const code = (node as HastNode | undefined)?.children?.[0];
      if (code?.type === "element" && code.tagName === "code") {
        const cls = (code.properties?.className as string[] | undefined) ?? [];
        let lang = cls.find((c) => c.startsWith("language-"))?.slice(9);
        // Models often fence diagrams as ```json or leave the language off; recognise them by content.
        if (!lang || lang === "json") {
          const head = hastText(code).trimStart().slice(0, 200);
          if (/^\{[\s\S]*"type"\s*:\s*"(figure|plot|flowchart|diagram|graph)"/.test(head)) lang = "diagram";
          else if (/^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b|^(sequenceDiagram|classDiagram|mindmap|stateDiagram)/.test(head)) lang = "mermaid";
        }
        if (lang === "mermaid" || lang === "diagram") {
          if (streaming) return <div className="my-4 rounded-lg border border-dashed border-[#d9d3c7] p-4 text-center text-[13px] text-[#8a8170]">Diagram, drawn when the notes finish…</div>;
          const text = hastText(code);
          return lang === "mermaid" ? <MermaidBlock code={text} /> : <DiagramBlock json={text} />;
        }
      }
      return <pre>{children}</pre>;
    },
    a({ href, children }) {
      const safe = href && /^(https?:|mailto:|#)/i.test(href) ? href : undefined;
      return (
        <a href={safe} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
  };
}

const Block = memo(function Block({ md, streaming }: { md: string; streaming: boolean }) {
  const components = useMemo(() => makeComponents(streaming), [streaming]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false, strict: "ignore", maxExpand: 300 }]]}
      components={components}
    >
      {md}
    </ReactMarkdown>
  );
});

export function MarkdownView({ content, streaming = false, className }: { content: string; streaming?: boolean; className?: string }) {
  const sections = useMemo(() => splitSections(content), [content]);
  return (
    <div className={cn("notes-doc", className)}>
      {sections.map((s, i) => (
        // Only the last section can still be growing while streaming.
        <Block key={i} md={s} streaming={streaming && i === sections.length - 1} />
      ))}
    </div>
  );
}
