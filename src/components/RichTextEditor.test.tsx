import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

afterEach(cleanup);

beforeAll(() => {
  document.elementFromPoint = () => document.body;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});

describe('RichTextEditor', () => {
  it('renders allowlisted marks and keeps tables unavailable in summaries', async () => {
    render(
      <RichTextEditor
        value={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '重点', marks: [{ type: 'bold' }] }] }]
        }}
        fallbackText="重点"
        allowTables={false}
        placeholder="摘要"
        ariaLabel="知识总结"
        onChange={vi.fn()}
      />
    );

    expect((await screen.findByText('重点')).tagName).toBe('STRONG');
    expect(screen.queryByRole('button', { name: '插入 3×3 表格' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加粗' })).toBeInTheDocument();
  });

  it('inserts an editable table and emits structured JSON', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        fallbackText="正文"
        placeholder="正文"
        ariaLabel="小节正文"
        onChange={onChange}
      />
    );

    await user.click(await screen.findByRole('button', { name: '插入 3×3 表格' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const latest = onChange.mock.calls.at(-1)?.[0];
    expect(latest.content.some((node: { type: string }) => node.type === 'table')).toBe(true);
    expect(screen.getByRole('button', { name: '添加行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除表格' })).toBeInTheDocument();
  });

  it('applies bold, color and list formatting from the toolbar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor fallbackText="" placeholder="正文" ariaLabel="格式正文" onChange={onChange} />
    );
    const textbox = await screen.findByRole('textbox', { name: '格式正文' });
    await user.click(textbox);
    await user.click(screen.getByRole('button', { name: '加粗' }));
    await user.selectOptions(screen.getByRole('combobox', { name: '文字颜色' }), 'var(--danger-text)');
    await user.type(textbox, '重点');
    expect(screen.getByText('重点').tagName).toBe('STRONG');

    await user.click(screen.getByRole('button', { name: '无序列表' }));
    await user.type(textbox, '列表项');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).toContain('var(--danger-text)');
    expect(document.querySelector('.rich-editor-content ul')).toBeInTheDocument();
  });
});
