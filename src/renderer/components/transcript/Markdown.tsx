/**
 * Safe Markdown renderer (spec §15.3). No HTML parsing, no
 * dangerouslySetInnerHTML anywhere — everything renders as React text nodes,
 * so script injection, inline handlers, iframes, and remote resources are
 * structurally impossible. Links require an explicit click and show their
 * hostname before opening in the system browser.
 */
import { useState, type ReactNode } from 'react';
import { api } from '../../app/api';
import { Modal } from '../common/ui';

type Align = 'left' | 'center' | 'right';

interface Block {
  type: 'p' | 'code' | 'h' | 'ul' | 'ol' | 'quote' | 'table';
  text?: string;
  lang?: string;
  level?: number;
  items?: string[];
  header?: string[];
  rows?: string[][];
  align?: Align[];
}

/** Split a GFM row on unescaped pipes, dropping the optional outer pipes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** `|---|:--:|` — the row that turns the line above it into a header. */
function isDelimiterRow(line: string): boolean {
  if (!line || !line.includes('-')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s+/g, '')));
}

function alignmentsFrom(line: string): Align[] {
  return splitRow(line).map((c) => {
    const spec = c.replace(/\s+/g, '');
    if (spec.startsWith(':') && spec.endsWith(':')) return 'center';
    if (spec.endsWith(':')) return 'right';
    return 'left';
  });
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence
      blocks.push({ type: 'code', text: buf.join('\n'), lang });
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'h', level: h[1]!.length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    // A table is a header row followed by a delimiter row. Checked before the
    // paragraph fallback, which would otherwise swallow it as pipe-laden text.
    if (line.includes('|') && isDelimiterRow(lines[i + 1] ?? '')) {
      const header = splitRow(line);
      const align = alignmentsFrom(lines[i + 1] ?? '');
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim() !== '' && (lines[i] ?? '').includes('|')) {
        const cells = splitRow(lines[i] ?? '');
        // Pad or trim so every row matches the header width.
        while (cells.length < header.length) cells.push('');
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ type: 'table', header, rows, align });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: buf.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const buf: string[] = [line];
    i++;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isBlockStart(lines[i] ?? '')) {
      buf.push(lines[i] ?? '');
      i++;
    }
    blocks.push({ type: 'p', text: buf.join('\n') });
  }
  return blocks;
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('```') ||
    line.includes('|') ||
    /^(#{1,3})\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*>/.test(line)
  );
}

/** Inline formatting: `code`, **bold**, *italic*, [text](https://url). */
function renderInline(text: string, onLink: (url: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('`')) {
      out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const label = token.slice(1, token.indexOf(']'));
      const url = m[5] ?? '';
      out.push(
        <button
          key={key++}
          onClick={() => onLink(url)}
          style={{ color: 'var(--accent-cyan)', textDecoration: 'underline', font: 'inherit' }}
        >
          {label}
        </button>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ text, lang }: { text: string; lang?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock">
      <button
        className="copy-btn"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre tabIndex={0} aria-label={lang ? `Code, ${lang}` : 'Code'}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function Markdown({ source }: { source: string }): React.JSX.Element {
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const blocks = parseBlocks(source);
  const onLink = (url: string): void => setPendingLink(url);

  let hostname = '';
  if (pendingLink) {
    try {
      hostname = new URL(pendingLink).hostname;
    } catch {
      hostname = 'invalid URL';
    }
  }

  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'code':
            return <CodeBlock key={i} text={b.text ?? ''} lang={b.lang} />;
          case 'h': {
            const Tag = b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3';
            return <Tag key={i}>{renderInline(b.text ?? '', onLink)}</Tag>;
          }
          case 'ul':
            return (
              <ul key={i}>
                {(b.items ?? []).map((item, j) => (
                  <li key={j}>{renderInline(item, onLink)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i}>
                {(b.items ?? []).map((item, j) => (
                  <li key={j}>{renderInline(item, onLink)}</li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div className="table-wrap" key={i}>
                <table>
                  <thead>
                    <tr>
                      {(b.header ?? []).map((cell, j) => (
                        <th key={j} style={{ textAlign: b.align?.[j] ?? 'left' }}>
                          {renderInline(cell, onLink)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(b.rows ?? []).map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, j) => (
                          <td key={j} style={{ textAlign: b.align?.[j] ?? 'left' }}>
                            {renderInline(cell, onLink)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'quote':
            return <blockquote key={i}>{renderInline(b.text ?? '', onLink)}</blockquote>;
          default:
            return <p key={i}>{renderInline(b.text ?? '', onLink)}</p>;
        }
      })}
      {pendingLink ? (
        <Modal
          title="Open external link?"
          onClose={() => setPendingLink(null)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setPendingLink(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void api().external.open(pendingLink);
                  setPendingLink(null);
                }}
              >
                Open {hostname}
              </button>
            </>
          }
        >
          <p>
            This opens <strong style={{ color: 'var(--text-primary)' }}>{hostname}</strong> in your
            system browser.
          </p>
          <div className="fingerprint">{pendingLink}</div>
        </Modal>
      ) : null}
    </>
  );
}
