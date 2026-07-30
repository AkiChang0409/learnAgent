import { Bot } from 'lucide-react';
import type { AgentExecutionProfile, AgentPersonaId, AgentPersonaSummary, AiProvider } from '../types';

export function PersonaSelector({
  personas,
  value,
  provider,
  executionProfile,
  onChange,
  compact = false
}: {
  personas: AgentPersonaSummary[];
  value: AgentPersonaId;
  provider: AiProvider;
  executionProfile?: AgentExecutionProfile;
  onChange: (value: AgentPersonaId) => void;
  compact?: boolean;
}) {
  const selected = personas.find((persona) => persona.id === value);
  return (
    <label className={`persona-selector ${compact ? 'compact' : ''}`}>
      <span className="persona-selector-label"><Bot size={15} /> Agent Persona</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as AgentPersonaId)}
        aria-label="Agent Persona"
      >
        {personas.map((persona) => {
          const modelBlocked = provider === 'local' && persona.requiresModelForProfessionalAnalysis;
          const profileBlocked = executionProfile && !persona.executionProfiles.includes(executionProfile);
          return (
            <option key={`${persona.id}@${persona.version}`} value={persona.id} disabled={Boolean(modelBlocked || profileBlocked)}>
              {persona.name}{modelBlocked ? '（需配置模型）' : profileBlocked ? '（不支持此策略）' : ''}
            </option>
          );
        })}
      </select>
      {!compact && selected && <small>{selected.description}</small>}
    </label>
  );
}
