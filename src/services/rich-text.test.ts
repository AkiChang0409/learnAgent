import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  applyEmphasisToDocument,
  normalizeRichBlocks,
  richBlocksToDocument,
  richTextToPlainText,
  sanitizeRichTextDocument,
  textToRichDocument
} from './rich-text';

describe('rich text conversion', () => {
  it('converts legacy Markdown-like lists and tables into editable nodes', () => {
    const document = textToRichDocument([
      '**关键概念**说明',
      '- 优势一',
      '- 优势二',
      '',
      '| 方案 | 优势 |',
      '| --- | --- |',
      '| A | 快 |',
      '| B | 稳 |'
    ].join('\n'));

    expect(document.content?.map((node) => node.type)).toEqual(['paragraph', 'bulletList', 'table']);
    expect(document.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }]);
    expect(richTextToPlainText(document)).toContain('方案\t优势\nA\t快\nB\t稳');
  });

  it('normalizes semantic AI blocks, clamps tables and limits values to the palette', () => {
    const blocks = normalizeRichBlocks([{
      type: 'table',
      headers: Array.from({ length: 8 }, (_, index) => [{ text: `H${index}`, tone: 'accent' }]),
      rows: Array.from({ length: 15 }, (_, row) => Array.from({ length: 8 }, (_, col) => [{
        text: `${row}-${col}`,
        highlight: 'yellow',
        tone: col === 0 ? 'danger' : 'not-allowed'
      }]))
    }]);

    expect(blocks[0]).toMatchObject({ type: 'table' });
    if (blocks[0].type !== 'table') throw new Error('expected table');
    expect(blocks[0].headers).toHaveLength(6);
    expect(blocks[0].rows).toHaveLength(12);
    expect(blocks[0].rows[0]).toHaveLength(6);
    expect(blocks[0].rows[0][0][0].tone).toBe('danger');
    expect(blocks[0].rows[0][1][0].tone).toBeUndefined();

    const document = richBlocksToDocument(blocks);
    expect(JSON.stringify(document)).toContain(TEXT_COLORS.danger);
    expect(JSON.stringify(document)).toContain(HIGHLIGHT_COLORS.yellow);
  });

  it('removes unknown nodes, arbitrary CSS and tables from summary content', () => {
    const document = sanitizeRichTextDocument({
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'bad' }] },
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '安全内容',
            marks: [
              { type: 'bold' },
              { type: 'textStyle', attrs: { color: 'url(javascript:bad)' } }
            ]
          }]
        },
        { type: 'table', content: [] }
      ]
    }, '', false);

    expect(document.content).toHaveLength(1);
    expect(document.content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }]);
    expect(richTextToPlainText(document)).toBe('安全内容');
  });

  it('adds exact phrase emphasis without changing list or table text and structure', () => {
    const original = textToRichDocument([
      '- Tiptap 保留编辑结构',
      '- Markdown 导入保持兼容',
      '',
      '| 风险 | 处理 |',
      '| --- | --- |',
      '| 格式丢失 | 使用纯文本投影 |',
      '| 任意样式 | 白名单校验 |'
    ].join('\n'));
    const emphasized = applyEmphasisToDocument(original, '', {
      boldPhrases: ['Tiptap', '纯文本投影'],
      tones: [{ text: 'Markdown', tone: 'accent' }],
      highlights: [{ text: '格式丢失', highlight: 'yellow' }]
    });

    expect(richTextToPlainText(emphasized)).toBe(richTextToPlainText(original));
    expect(emphasized.content?.map((node) => node.type)).toEqual(['bulletList', 'table']);
    expect(JSON.stringify(emphasized)).toContain(TEXT_COLORS.accent);
    expect(JSON.stringify(emphasized)).toContain(HIGHLIGHT_COLORS.yellow);
    expect(JSON.stringify(emphasized)).toContain('bold');
  });
});
