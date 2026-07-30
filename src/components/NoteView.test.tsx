import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../types';
import { NoteView } from './NoteView';

vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({ ariaLabel }: { ariaLabel: string }) => <div aria-label={ariaLabel} />
}));

afterEach(cleanup);

const note: Note = {
  id: 'note-1',
  title: '撤销测试',
  subject: '工程',
  topic: '历史记录',
  tags: [],
  summary: '',
  sections: [{ id: 'section-1', heading: '可删除小节', content: '' }],
  cases: ['案例一'],
  pitfalls: [],
  interviewQuestions: [],
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z'
};

function renderNote(overrides: Partial<ComponentProps<typeof NoteView>> = {}) {
  const props: ComponentProps<typeof NoteView> = {
    note,
    subjectOptions: ['工程'],
    assistantOpen: false,
    conversationCount: 0,
    onChange: vi.fn(),
    onDelete: vi.fn(),
    onAddSection: vi.fn(),
    onUpdateSection: vi.fn(),
    onRemoveSection: vi.fn(),
    onMoveSection: vi.fn(),
    onUpdateList: vi.fn(),
    onToggleAssistant: vi.fn(),
    onNavigateSubject: vi.fn(),
    onAnalyzeEmphasis: vi.fn(),
    isAnalyzingEmphasis: false,
    subjectNoteCount: 1,
    ...overrides
  };
  render(<NoteView {...props} />);
  return props;
}

describe('NoteView deletion intents', () => {
  it('marks list deletion as a reversible structural change', async () => {
    const user = userEvent.setup();
    const props = renderNote();

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(props.onUpdateList).toHaveBeenCalledWith('cases', [], 'remove');
  });

  it('routes section deletion through the note-level handler', async () => {
    const user = userEvent.setup();
    const props = renderNote();

    await user.click(screen.getByRole('button', { name: '删除小节' }));

    expect(props.onRemoveSection).toHaveBeenCalledWith('section-1');
  });
});

describe('NoteView Persona document shape', () => {
  it('renders a Persona summary label and routes dynamic collection edits', async () => {
    const onUpdateCollection = vi.fn();
    renderNote({
      note: {
        ...note,
        personaId: 'job-description-analyst',
        personaVersion: 1,
        summaryLabel: '岗位分析摘要',
        collections: [{ id: 'core-requirements', title: '核心要求', items: ['SQL'] }]
      },
      onUpdateCollection
    });

    expect(screen.getByText('岗位分析摘要')).toBeInTheDocument();
    expect(screen.getByText('核心要求')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onUpdateCollection).toHaveBeenCalledWith('core-requirements', [], 'remove');
  });
});
