import { useState } from 'react';
import type { AgentIdentity, CliType } from '../types';
import CreateAgentForm from './CreateAgentForm';

interface AgentPickerProps {
  agents: AgentIdentity[];
  agentmailConfigured: boolean;
  onSelect: (agent: AgentIdentity | null, cliType: CliType) => void;
  onCreateAgent: (name: string, defaultCliType: string) => Promise<AgentIdentity | null>;
  onClose: () => void;
}

const CLI_OPTIONS: { value: CliType; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'bash', label: 'Bash Shell' },
];

export default function AgentPicker({ agents, agentmailConfigured, onSelect, onCreateAgent, onClose }: AgentPickerProps) {
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [selectedCli, setSelectedCli] = useState<CliType>('claude');
  const [creating, setCreating] = useState(false);

  const handleSelectAgent = (agent: AgentIdentity) => {
    onSelect(agent, selectedCli);
  };

  const handleQuickLaunch = () => {
    onSelect(null, selectedCli);
  };

  const handleCreate = async (name: string, defaultCliType: string) => {
    setCreating(true);
    const agent = await onCreateAgent(name, defaultCliType);
    setCreating(false);
    if (agent) {
      onSelect(agent, defaultCliType as CliType);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{mode === 'pick' ? 'Launch Agent Terminal' : 'Create New Agent'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {mode === 'pick' ? (
          <div className="modal-body">
            <div className="cli-selector">
              <label>CLI Tool:</label>
              <div className="cli-options">
                {CLI_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`cli-option ${selectedCli === opt.value ? 'active' : ''}`}
                    onClick={() => setSelectedCli(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="agent-list-section">
              <div className="agent-list-header">
                <span>Existing Agents</span>
                <button className="text-btn" onClick={() => setMode('create')}>+ New Agent</button>
              </div>

              {agents.length === 0 ? (
                <p className="empty-text">No agents yet. Create one or launch without identity.</p>
              ) : (
                <div className="agent-list">
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      className="agent-item"
                      onClick={() => handleSelectAgent(agent)}
                    >
                      <span className="agent-name">{agent.name}</span>
                      <span className="agent-email">{agent.email || 'No email'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="secondary-btn" onClick={handleQuickLaunch}>
                Launch Without Agent
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <CreateAgentForm
              onSubmit={handleCreate}
              onBack={() => setMode('pick')}
              creating={creating}
              agentmailConfigured={agentmailConfigured}
            />
          </div>
        )}
      </div>
    </div>
  );
}
