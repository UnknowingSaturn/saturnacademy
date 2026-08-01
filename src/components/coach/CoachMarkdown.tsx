import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TradeCitationCard, type TradeCitation } from "./TradeCitationCard";

/** Markdown with report-style typography: eyebrow headings, insight blockquotes, dense tables. */
export function CoachMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <SectionEyebrow>{children}</SectionEyebrow>,
        h2: ({ children }) => <SectionEyebrow>{children}</SectionEyebrow>,
        h3: ({ children }) => <SectionEyebrow>{children}</SectionEyebrow>,
        p: ({ children }) => <p className="text-sm leading-relaxed text-foreground/90 my-2">{children}</p>,
        ul: ({ children }) => <ul className="my-2 space-y-1.5 pl-4 list-disc marker:text-muted-foreground/60">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 space-y-1.5 pl-4 list-decimal marker:text-muted-foreground/60">{children}</ol>,
        li: ({ children }) => <li className="text-sm leading-relaxed text-foreground/90">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-muted text-foreground/90">{children}</code>
        ),
        blockquote: ({ children }) => (
          <div className="my-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-relaxed text-foreground/90 [&_p]:my-0">
            {children}
          </div>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="text-left font-semibold uppercase tracking-wide text-[10px] text-muted-foreground bg-muted/40 px-2.5 py-1.5 border-b border-border">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="px-2.5 py-1.5 border-b border-border/50 text-foreground/90">{children}</td>,
        hr: () => <hr className="my-4 border-border/60" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{children}</span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  );
}

/** Bordered analysis block, used for "Screenshot N (...)" callouts. */
function SectionCard({ title, tag, body }: { title: string; tag?: string; body: string }) {
  return (
    <div className="my-2.5 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-bold uppercase tracking-wide text-foreground truncate">{title}</span>
        {tag && (
          <span className="shrink-0 text-[9px] text-muted-foreground px-1.5 py-0.5 rounded bg-background/80 border border-border/60">
            {tag}
          </span>
        )}
      </div>
      <div className="px-3 py-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 text-xs">
        <CoachMarkdown>{body}</CoachMarkdown>
      </div>
    </div>
  );
}

const TRADE_RE =
  /^(?:[-*+]\s+)?\*\*([A-Z0-9._#]{2,14})\s+(Buy|Sell|Long|Short)\s*\(([^)]+)\):?\*\*:?\s*(.*)$/i;
const SCREENSHOT_RE = /^(?:[-*+]\s+)?\*\*(Screenshot\s+\d+)\s*(?:[—:-]\s*)?(?:\(([^)]*)\))?\s*:?\*\*:?\s*(.*)$/i;
const R_RE = /(-?\d+(?:\.\d+)?)\s*R\b/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Block =
  | { kind: "md"; text: string }
  | { kind: "trade"; citation: TradeCitation }
  | { kind: "section"; title: string; tag?: string; body: string };

/** Split assistant prose into markdown chunks, trade citation cards and section cards. */
export function parseAssistantBody(text: string): Block[] {
  const out: Block[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push({ kind: "md", text: t });
    buf = [];
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    const shot = trimmed.match(SCREENSHOT_RE);
    if (shot) {
      flush();
      out.push({ kind: "section", title: shot[2]?.trim() || shot[1], tag: shot[1], body: shot[3] ?? "" });
      continue;
    }

    const tr = trimmed.match(TRADE_RE);
    if (tr) {
      flush();
      const rest = tr[4] ?? "";
      const r = rest.match(R_RE);
      const id = rest.match(UUID_RE);
      out.push({
        kind: "trade",
        citation: {
          symbol: tr[1].toUpperCase(),
          side: tr[2],
          date: tr[3],
          detail: rest.replace(R_RE, "").replace(UUID_RE, "").replace(/^[A\s]*(loss|win|gain)?\s*(on a)?\s*/i, "").replace(/\s+/g, " ").trim() || null,
          r: r ? Number(r[1]) : null,
          tradeId: id ? id[0] : null,
        },
      });
      continue;
    }

    buf.push(line);
  }
  flush();
  return out;
}

export function AssistantBody({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseAssistantBody(text), [text]);
  const cards: React.ReactNode[] = [];

  return (
    <div className="max-w-[68ch]">
      {blocks.map((b, i) => {
        if (b.kind === "trade") return <div key={i} className="my-1.5"><TradeCitationCard c={b.citation} /></div>;
        if (b.kind === "section") return <SectionCard key={i} title={b.title} tag={b.tag} body={b.body} />;
        return (
          <div key={i} className="[&>*:first-child]:mt-0">
            <CoachMarkdown>{b.text}</CoachMarkdown>
          </div>
        );
      })}
      {cards}
    </div>
  );
}
