import { useState } from 'react';
import type { CliType } from '../types';

interface CreateAgentFormProps {
  onSubmit: (name: string, defaultCliType: string) => void;
  onBack: () => void;
  creating: boolean;
  agentmailConfigured: boolean;
  submitLabel?: string;
}

const CLI_OPTIONS: { value: CliType; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'codex', label: 'Codex CLI' },
];

export default function CreateAgentForm({ onSubmit, onBack, creating, agentmailConfigured, submitLabel }: CreateAgentFormProps) {
  const [name, setName] = useState('');
  const [cliType, setCliType] = useState<string>('claude');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), cliType);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="agent-name">Agent Name</label>
        <input
          id="agent-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., Alice, Backend-Agent, Researcher"
          autoFocus
          disabled={creating}
        />
      </div>

      <div className="form-group">
        <label>Default CLI</label>
        <div className="cli-options">
          {CLI_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`cli-option ${cliType === opt.value ? 'active' : ''}`}
              onClick={() => setCliType(opt.value)}
              disabled={creating}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!agentmailConfigured && (
        <p className="warning-text">
          AgentMail API key not configured. Agent will be created without an email address.
          Set AGENTMAIL_API_KEY in .env to enable email provisioning.
        </p>
      )}

      <div className="form-actions">
        <button type="button" className="secondary-btn" onClick={onBack} disabled={creating}>
          Back
        </button>
        <button type="submit" className="primary-btn" disabled={!name.trim() || creating}>
          {creating ? 'Creating...' : (submitLabel || 'Create & Launch')}
        </button>
      </div>
    </form>
  );
}
