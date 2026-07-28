import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TipsDialog } from './TipsDialog';

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
});
