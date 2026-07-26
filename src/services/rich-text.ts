import type {
  RichContentBlock,
  RichTextDocument,
  RichTextHighlight,
  RichTextNode,
  RichTextRun,
  RichTextTone
} from '../types';

export const TEXT_COLORS: Record<RichTextTone, string> = {
  accent: 'var(--accent-soft-text)',
  success: 'var(--success)',
  warning: 'var(--warning-text)',
  danger: 'var(--danger-text)'
};

export const HIGHLIGHT_COLORS: Record<RichTextHighlight, string> = {
  yellow: 'var(--warning-soft-bg)',
  green: 'var(--success-soft-bg)',
  blue: 'var(--accent-soft-bg)',
  red: 'var(--danger-soft-bg)'
};

const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem',
  'table', 'tableRow', 'tableHeader', 'tableCell'
]);
const ALLOWED_MARKS = new Set(['bold', 'textStyle', 'highlight']);
const ALLOWED_CHILDREN: Record<string, Set<string>> = {
  doc: new Set(['paragraph', 'bulletList', 'orderedList', 'table']),
  paragraph: new Set(['text', 'hardBreak']),
  bulletList: new Set(['listItem']),
  orderedList: new Set(['listItem']),
  listItem: new Set(['paragraph', 'bulletList', 'orderedList']),
  table: new Set(['tableRow']),
  tableRow: new Set(['tableHeader', 'tableCell']),
  tableHeader: new Set(['paragraph', 'bulletList', 'orderedList']),
  tableCell: new Set(['paragraph', 'bulletList', 'orderedList'])
};
const allowedTextColors = new Set(Object.values(TEXT_COLORS));
const allowedHighlights = new Set(Object.values(HIGHLIGHT_COLORS));
const MAX_TEXT_LENGTH = 100_000;

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, MAX_TEXT_LENGTH);
}

function textNode(run: RichTextRun): RichTextNode | null {
  const text = cleanText(run.text);
  if (!text) return null;
  const marks: NonNullable<RichTextNode['marks']> = [];
  if (run.bold) marks.push({ type: 'bold' });
  if (run.tone && TEXT_COLORS[run.tone]) marks.push({ type: 'textStyle', attrs: { color: TEXT_COLORS[run.tone] } });
  if (run.highlight && HIGHLIGHT_COLORS[run.highlight]) {
    marks.push({ type: 'highlight', attrs: { color: HIGHLIGHT_COLORS[run.highlight] } });
  }
  return { type: 'text', text, ...(marks.length ? { marks } : {}) };
}

function paragraph(runs: RichTextRun[]): RichTextNode {
  return { type: 'paragraph', content: runs.map(textNode).filter(Boolean) as RichTextNode[] };
}

function normalizeRuns(value: unknown): RichTextRun[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((run): RichTextRun => {
    if (typeof run === 'string') return { text: cleanText(run) };
    const source = run && typeof run === 'object' ? run as Record<string, unknown> : {};
    const tone = ['accent', 'success', 'warning', 'danger'].includes(String(source.tone))
      ? source.tone as RichTextTone : undefined;
    const highlight = ['yellow', 'green', 'blue', 'red'].includes(String(source.highlight))
      ? source.highlight as RichTextHighlight : undefined;
    return { text: cleanText(source.text), bold: source.bold === true, tone, highlight };
  }).filter((run) => run.text);
}

export function normalizeRichBlocks(value: unknown, allowTables = true): RichContentBlock[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((entry): RichContentBlock[] => {
    const source = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    if (source.type === 'paragraph') {
      const runs = normalizeRuns(source.runs);
      return runs.length ? [{ type: 'paragraph', runs }] : [];
    }
    if (source.type === 'bulletList' || source.type === 'orderedList') {
      const items = (Array.isArray(source.items) ? source.items : [])
        .slice(0, 40).map(normalizeRuns).filter((item) => item.length);
      return items.length ? [{ type: source.type, items }] : [];
    }
    if (source.type === 'table' && allowTables) {
      const rawHeaders = (Array.isArray(source.headers) ? source.headers : []).slice(0, 6);
      const rawRows = (Array.isArray(source.rows) ? source.rows : []).slice(0, 12);
      const width = Math.min(6, Math.max(rawHeaders.length, ...rawRows.map((row) => Array.isArray(row) ? row.length : 0)));
      if (width < 2 || rawRows.length < 2) return [];
      const cells = (row: unknown[]) => Array.from({ length: width }, (_, index) => normalizeRuns(row[index]));
      const headers = cells(rawHeaders);
      const rows = rawRows.map((row) => cells(Array.isArray(row) ? row : []));
      return [{ type: 'table', headers, rows }];
    }
    return [];
  });
}

export function richBlocksToDocument(blocks: RichContentBlock[], allowTables = true): RichTextDocument {
  const content = normalizeRichBlocks(blocks, allowTables).flatMap((block): RichTextNode[] => {
    if (block.type === 'paragraph') return [paragraph(block.runs)];
    if (block.type !== 'table') {
      return [{
        type: block.type,
        content: block.items.map((item) => ({ type: 'listItem', content: [paragraph(item)] }))
      }];
    }
    return [{
      type: 'table',
      content: [
        { type: 'tableRow', content: block.headers.map((cell) => ({ type: 'tableHeader', content: [paragraph(cell)] })) },
        ...block.rows.map((row) => ({
          type: 'tableRow',
          content: row.map((cell) => ({ type: 'tableCell', content: [paragraph(cell)] }))
        }))
      ]
    }];
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function parseInline(text: string): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const source = cleanText(text);
  let cursor = 0;
  for (const match of source.matchAll(/\*\*(.+?)\*\*/g)) {
    const index = match.index ?? 0;
    if (index > cursor) runs.push({ text: source.slice(cursor, index) });
    runs.push({ text: match[1], bold: true });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) runs.push({ text: source.slice(cursor) });
  return runs.length ? runs : [{ text: source }];
}

export function textToRichDocument(value: string, allowTables = true): RichTextDocument {
  const lines = cleanText(value).split(/\r?\n/);
  const blocks: RichContentBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    if (allowTables && line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(next)) {
      const split = (input: string) => input.trim().replace(/^\||\|$/g, '').split('|').map((cell) => parseInline(cell.trim()));
      const headers = split(line);
      const rows: RichTextRun[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) rows.push(split(lines[index++]));
      blocks.push({ type: 'table', headers, rows });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: RichTextRun[][] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(parseInline(lines[index++].replace(/^\s*[-*+]\s+/, '')));
      }
      blocks.push({ type: 'bulletList', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: RichTextRun[][] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(parseInline(lines[index++].replace(/^\s*\d+[.)]\s+/, '')));
      }
      blocks.push({ type: 'orderedList', items });
      continue;
    }
    if (line.trim()) blocks.push({ type: 'paragraph', runs: parseInline(line.trim()) });
    index += 1;
  }
  return richBlocksToDocument(blocks, allowTables);
}

function sanitizeMarks(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const marks = value.flatMap((mark) => {
    if (!mark || typeof mark !== 'object') return [];
    const source = mark as Record<string, unknown>;
    const type = String(source.type || '');
    if (!ALLOWED_MARKS.has(type)) return [];
    if (type === 'bold') return [{ type }];
    const attrs = source.attrs && typeof source.attrs === 'object' ? source.attrs as Record<string, unknown> : {};
    const color = String(attrs.color || '');
    if (type === 'textStyle' && allowedTextColors.has(color)) return [{ type, attrs: { color } }];
    if (type === 'highlight' && allowedHighlights.has(color)) return [{ type, attrs: { color } }];
    return [];
  });
  return marks.length ? marks : undefined;
}

function sanitizeNode(value: unknown, depth = 0, parentType?: string): RichTextNode | null {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  const source = value as Record<string, unknown>;
  const type = String(source.type || '');
  if (!ALLOWED_NODES.has(type)) return null;
  if (parentType && !ALLOWED_CHILDREN[parentType]?.has(type)) return null;
  if (type === 'text') {
    const text = cleanText(source.text);
    return text ? { type, text, ...(sanitizeMarks(source.marks) ? { marks: sanitizeMarks(source.marks) } : {}) } : null;
  }
  const limit = type === 'table' ? 13 : type === 'tableRow' ? 6 : 100;
  const content = (Array.isArray(source.content) ? source.content : [])
    .slice(0, limit)
    .map((child) => sanitizeNode(child, depth + 1, type)).filter(Boolean) as RichTextNode[];
  return { type, ...(content.length ? { content } : {}) };
}

export function sanitizeRichTextDocument(value: unknown, fallbackText = '', allowTables = true): RichTextDocument {
  const root = sanitizeNode(value);
  if (!root || root.type !== 'doc') return textToRichDocument(fallbackText, allowTables);
  if (!allowTables) root.content = (root.content || []).filter((node) => node.type !== 'table');
  if (!root.content?.length) root.content = [{ type: 'paragraph' }];
  return root as RichTextDocument;
}

function nodeText(node: RichTextNode, listIndex?: number): string {
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'listItem') return `${listIndex === undefined ? '- ' : `${listIndex + 1}. `}${(node.content || []).map((child) => nodeText(child)).join('')}`;
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content || []).map((child, index) => nodeText(child, node.type === 'orderedList' ? index : undefined)).join('\n');
  }
  if (node.type === 'tableRow') return (node.content || []).map((child) => nodeText(child)).join('\t');
  if (node.type === 'table') return (node.content || []).map((child) => nodeText(child)).join('\n');
  return (node.content || []).map((child) => nodeText(child)).join('');
}

export function richTextToPlainText(value: RichTextDocument | undefined, fallback = '') {
  if (!value) return fallback;
  return (value.content || []).map((node) => nodeText(node)).filter(Boolean).join('\n\n').trim();
}

export function richContentFromDraft(blocks: RichContentBlock[] | undefined, fallback: string, allowTables = true) {
  return blocks?.length ? richBlocksToDocument(blocks, allowTables) : textToRichDocument(fallback, allowTables);
}

export function appendRichTextDocument(
  current: RichTextDocument | undefined,
  currentFallback: string,
  addition: RichTextDocument,
  allowTables = true
) {
  const base = sanitizeRichTextDocument(current, currentFallback, allowTables);
  return sanitizeRichTextDocument({
    type: 'doc',
    content: [...(base.content || []), ...(addition.content || [])]
  }, '', allowTables);
}
