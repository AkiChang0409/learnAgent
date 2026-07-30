import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentPersonaSummary } from '../types';
import { PersonaSelector } from './PersonaSelector';

afterEach(cleanup);

const personas: AgentPersonaSummary[] = [
  {
    id: 'learning-notes', version: 1, name: '学习笔记整理', description: '学习', summaryLabel: '知识总结',
    operations: ['generate', 'import', 'chat', 'memory', 'distill'], executionProfiles: ['focused', 'fast', 'deep', 'offline'],
    importTopology: 'knowledge-map', requiresModelForProfessionalAnalysis: false,
    collectionBlueprint: [{ id: 'cases', title: '案例' }]
  },
  {
    id: 'job-description-analyst', version: 1, name: 'Job Description 分析', description: '岗位', summaryLabel: '岗位分析摘要',
    operations: ['generate', 'import', 'chat', 'memory', 'distill'], executionProfiles: ['focused', 'fast', 'deep'],
    importTopology: 'single-document', requiresModelForProfessionalAnalysis: true,
    collectionBlueprint: [{ id: 'core-requirements', title: '核心要求' }]
  }
];

describe('PersonaSelector', () => {
  it('switches Persona when the selected provider supports it', async () => {
    const onChange = vi.fn();
    render(<PersonaSelector personas={personas} value="learning-notes" provider="openai-compatible" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Agent Persona'), 'job-description-analyst');
    expect(onChange).toHaveBeenCalledWith('job-description-analyst');
  });

  it('disables professional Persona options for Local Provider', () => {
    render(<PersonaSelector personas={personas} value="learning-notes" provider="local" onChange={() => undefined} />);
    expect(screen.getByRole('option', { name: /Job Description 分析/ })).toBeDisabled();
  });
});
