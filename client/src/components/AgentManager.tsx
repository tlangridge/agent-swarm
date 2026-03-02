import { useState } from 'react';
import type { AgentIdentity, Office } from '../types';
import CreateAgentForm from './CreateAgentForm';
import AgentDetail from './AgentDetail';
import AgentBrowser from './AgentBrowser';

interface Props {
  agents: AgentIdentity[];
  offices: Office[];
  agentmailConfigured: boolean;
  onCreateAgent: (name: string, defaultCliType: string) => Promise<AgentIdentity | null>;
  onUpdateAgent: (id: string, updates: Partial<Pick<AgentIdentity, 'name' | 'defaultCliType' | 'soul' | 'memory' | 'instructions'>>) => Promise<AgentIdentity | null>;
  onDeleteAgent: (id: string) => Promise<boolean>;
  onUpdateOffice: (id: string, updates: Partial<Pick<Office, 'name' | 'slots' | 'pipeline' | 'cronJobs' | 'soul' | 'memory' | 'instructions'>>) => Promise<void>;
  onBack: () => void;
}

export default function AgentManager({ agents, offices, agentmailConfigured, onCreateAgent, onUpdateAgent, onDeleteAgent, onUpdateOffice, onBack }: Props) {
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selectedAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null;

  const handleCreate = async (name: string, defaultCliType: string) => {
    setCreating(true);
    const result = await onCreateAgent(name, defaultCliType);
    setCreating(false);
    if (result) setMode('list');
  };

  // Detail view for a single agent
  if (selectedAgent) {
    return (
      <div className="agent-manager-page">
        <div className="agent-manager-topbar">
          <button className="agent-manager-back" onClick={() => setSelectedAgentId(null)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
            </svg>
            All Agents
          </button>
          <h2>{selectedAgent.name}</h2>
          <div className="agent-manager-topbar-actions" />
        </div>
        <div className="agent-manager-body">
          <AgentDetail
            agent={selectedAgent}
            offices={offices}
            onUpdate={onUpdateAgent}
            onDelete={onDeleteAgent}
            onUpdateOffice={onUpdateOffice}
            onBack={() => setSelectedAgentId(null)}
          />
        </div>
      </div>
    );
  }

  // List / grid / create views
  return (
    <div className="agent-manager-page">
      <div className="agent-manager-topbar">
        <button className="agent-manager-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          </svg>
          Back
        </button>
        <h2>Agent Identities</h2>
        <div className="agent-manager-topbar-actions">
          {mode === 'list' && (
            <button className="office-btn primary" onClick={() => setMode('create')}>
              + New Agent
            </button>
          )}
        </div>
      </div>

      <div className="agent-manager-body">
        {mode === 'create' ? (
          <div className="agent-manager-create-form">
            <CreateAgentForm
              onSubmit={handleCreate}
              onBack={() => setMode('list')}
              creating={creating}
              agentmailConfigured={agentmailConfigured}
              submitLabel="Create Agent"
            />
          </div>
        ) : (
          <AgentBrowser
            agents={agents}
            onClickAgent={agent => setSelectedAgentId(agent.id)}
          />
        )}
      </div>
    </div>
  );
}
