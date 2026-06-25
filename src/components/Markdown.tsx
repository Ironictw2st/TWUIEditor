import type { ReactNode } from "react";

// Tiny markdown renderer for release/patch notes (our own CHANGELOG content, so a small
// subset is enough): #/##/### headings, - / * bullet lists, **bold**, inline `code`, and
// blank-line paragraphs. Links [text](url) render as their styled text. If richer markdown is
// ever needed, swap this for react-markdown.

/** Inline spans: **bold**, `code`, [text](url). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined)
      out.push(
        <code key={key++} className="px-1 rounded bg-sunken text-[10px]">
          {m[2]}
        </code>
      );
    else if (m[3] !== undefined) out.push(<span key={key++} className="underline">{m[3]}</span>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <div key={key++} className="text-[11px] font-semibold text-text mt-1">
          {inline(h[2])}
        </div>
      );
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>);
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-4 space-y-0.5">
          {items}
        </ul>
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }

  return <div className="space-y-1">{blocks}</div>;
}
