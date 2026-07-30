import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportModeDialog } from './ImportModeDialog';

describe('ImportModeDialog', () => {
  it('surfaces the official project Markdown workflow before import', async () => {
    const onOpenTips = vi.fn();
    render(
      <ImportModeDialog
        selection={{
          selectionId: 'selection-1',
          fileName: 'project.md',
          characterCount: 8000,
          chunkCount: 2,
          estimatedCalls: { fast: 5, deep: 11, offline: 0 }
        }}
        onStart={vi.fn()}
        onClose={vi.fn()}
        onOpenTips={onOpenTips}
      />
    );

    expect(screen.getByText('导入项目资料？')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看方案' }));
    expect(onOpenTips).toHaveBeenCalledOnce();
  });
});
