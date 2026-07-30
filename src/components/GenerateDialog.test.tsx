import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerateDialog } from './GenerateDialog';

afterEach(cleanup);

describe('GenerateDialog', () => {
  it('explains the focused single-note contract and submits with the keyboard shortcut', () => {
    const onGenerate = vi.fn();
    render(
      <GenerateDialog
        open
        value="只分析 MLOps 持续交付闭环"
        targetSubject="计算机科学"
        isGenerating={false}
        isListening={false}
        voiceError=""
        onChange={vi.fn()}
        onGenerate={onGenerate}
        onToggleListening={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('只解决一个核心问题')).toBeInTheDocument();
    expect(screen.getByText('不整段复制材料')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成聚焦笔记' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(onGenerate).toHaveBeenCalledOnce();
  });
});
