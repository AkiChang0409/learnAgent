import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TipsDialog } from './TipsDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TipsDialog', () => {
  it('presents the official Codex workflow and copies the complete skill', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onCopied = vi.fn();
    render(<TipsDialog open onClose={vi.fn()} onCopied={onCopied} />);

    expect(screen.getByText('官方推荐')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '复制 Skill 内容' }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('name: codebase-technical-analysis-writer');
    expect(writeText.mock.calls[0][0]).toContain('## Required Output Structure');
    expect(onCopied).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('copies the recommended Codex instruction and downloads SKILL.md', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:skill');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    render(<TipsDialog open onClose={vi.fn()} onCopied={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '复制 Codex 指令' }));
    expect(writeText.mock.calls[0][0]).toContain('可导入 LearnAgent');
    expect(screen.getByRole('button', { name: '指令已复制' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '下载 SKILL.md' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});
