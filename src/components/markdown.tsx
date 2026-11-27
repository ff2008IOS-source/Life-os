import { Fragment, type ReactNode } from "react";

/**
 * A small, safe Markdown renderer for AI answers: headings, paragraphs,
 * lists, tables, bold/italic/code and links. Builds React elements only
 * (no raw HTML), and links are limited to http(s) and same-site paths.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text)}</div>;
}

const safeHref = (url: string) =>
  /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : null;

export function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) {
      const href = safeHref(m[2]);
      out.push(
        href ? (
          <a
            key={k}
            href={href}
            target={href.startsWith("/") ? undefined : "_blank"}
            rel="noreferrer"
          >
            {inline(m[1], k)}
          </a>
        ) : (
          m[1]
        ),
      );
    } else if (m[3] !== undefined)
      out.push(<strong key={k}>{inline(m[3], k)}</strong>);
    else if (m[4] !== undefined) out.push(<code key={k}>{m[4]}</code>);
    else out.push(<em key={k}>{inline(m[5] ?? m[6], k)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(4, h[1].length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      out.push(<Tag key={k}>{inline(h[2], k)}</Tag>);
      i++;
      continue;
    }
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")
    ) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]))
        rows.push(cells(lines[i++]));
      out.push(
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, `${k}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, `${k}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={k}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${k}l${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    )
      para.push(lines[i++]);
    out.push(
      <p key={k}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l, `${k}p${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}
