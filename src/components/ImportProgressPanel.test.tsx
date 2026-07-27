import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImportProgressPanel } from './ImportProgressPanel';

describe('ImportProgressPanel', () => {
  it('shows a user-facing phase and a separate current task', () => {
    render(<ImportProgressPanel progress={{
      stage: 'extracting',
      message: '理解文档内容',
      phaseTitle: '理解文档内容',
      phaseCurrent: 2,
      phaseTotal: 5,
      taskMessage: '已理解“安装与配置”',
      current: 1,
      total: 3,
      percent: 22,
      fileName: 'guide.md',
      agentId: 'document.ingestor',
      updatedAt: '2026-07-27T00:00:00.000Z'
    }} />);

    expect(screen.getByText('第 2/5 步')).toBeInTheDocument();
    expect(screen.getByText('理解文档内容')).toBeInTheDocument();
    expect(screen.getByText('已理解“安装与配置”')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.queryByText('document.ingestor')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '22');
  });

  it('keeps cancellation available without mixing it into task text', () => {
    const onCancel = vi.fn();
    render(<ImportProgressPanel progress={{
      stage: 'organizing',
      message: '生成笔记内容',
      phaseTitle: '生成笔记内容',
      phaseCurrent: 3,
      phaseTotal: 5,
      taskMessage: '正在生成 2 篇笔记',
      percent: 58,
      canCancel: true,
      updatedAt: '2026-07-27T00:00:00.000Z'
    }} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
