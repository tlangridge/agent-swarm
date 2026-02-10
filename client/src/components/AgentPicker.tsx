import { useState } from 'react';
import type { AgentIdentity, CliType, ExecutionMode, PermissionMode, SwarmRole } from '../types';
import CreateAgentForm from './CreateAgentForm';

interface AgentPickerProps {
  agents: AgentIdentity[];
  agentmailConfigured: boolean;
  dockerAvailable: boolean;
  dockerImageBuilt: boolean;
  leadSessionId: string | null;
  onSelect: (agent: AgentIdentity | null, cliType: CliType, executionMode: ExecutionMode, permissionMode: PermissionMode, swarmRole: SwarmRole) => void;
  onCreateAgent: (name: string, defaultCliType: string) => Promise<AgentIdentity | null>;
  onBuildDockerImage?: () => Promise<void>;
  onClose: () => void;
}

const CLI_OPTIONS: { value: CliType; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'bash', label: 'Bash Shell' },
];

export default function AgentPicker({ agents, agentmailConfigured, dockerAvailable, dockerImageBuilt, leadSessionId, onSelect, onCreateAgent, onBuildDockerImage, onClose }: AgentPickerProps) {
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [selectedCli, setSelectedCli] = useState<CliType>('claude');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('local');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('autonomous');
  const [swarmRole, setSwarmRole] = useState<SwarmRole>('worker');
  const [creating, setCreating] = useState(false);
  const [building, setBuilding] = useState(false);

  const handleSelectAgent = (agent: AgentIdentity) => {
    onSelect(agent, selectedCli, executionMode, permissionMode, swarmRole);
  };

  const handleQuickLaunch = () => {
    onSelect(null, selectedCli, executionMode, permissionMode, swarmRole);
  };

  const handleCreate = async (name: string, defaultCliType: string) => {
    setCreating(true);
    const agent = await onCreateAgent(name, defaultCliType);
    setCreating(false);
    if (agent) {
      onSelect(agent, defaultCliType as CliType, executionMode, permissionMode, swarmRole);
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

            {dockerAvailable && (
              <div className="cli-selector">
                <label>Execution Mode:</label>
                <div className="cli-options">
                  <button
                    className={`cli-option ${executionMode === 'local' ? 'active' : ''}`}
                    onClick={() => setExecutionMode('local')}
                  >
                    Local
                  </button>
                  <button
                    className={`cli-option ${executionMode === 'docker' ? 'active' : ''}`}
                    onClick={() => setExecutionMode('docker')}
                  >
                    Docker
                  </button>
                </div>
                {executionMode === 'docker' && building && (
                  <div className="warning-text" style={{ marginTop: 8 }}>
                    Building Docker image... (this may take a few minutes, check terminal for progress)
                  </div>
                )}
                {executionMode === 'docker' && !building && !dockerImageBuilt && (
                  <div className="warning-text" style={{ marginTop: 8 }}>
                    Docker image not built yet.{' '}
                    {onBuildDockerImage ? (
                      <button className="text-btn" onClick={async () => {
                        setBuilding(true);
                        await onBuildDockerImage();
                        setBuilding(false);
                      }}>Build now</button>
                    ) : (
                      <span>Run: <code>docker build -t agent-swarm-sandbox docker/</code></span>
                    )}
                  </div>
                )}
              </div>
            )}

            {selectedCli === 'claude' && (
              <div className="cli-selector">
                <label>Permission Mode:</label>
                <div className="cli-options">
                  <button
                    className={`cli-option ${permissionMode === 'autonomous' ? 'active' : ''}`}
                    onClick={() => setPermissionMode('autonomous')}
                  >
                    Autonomous
                  </button>
                  <button
                    className={`cli-option ${permissionMode === 'regular' ? 'active' : ''}`}
                    onClick={() => setPermissionMode('regular')}
                  >
                    Regular
                  </button>
                </div>
              </div>
            )}

            <div className="cli-selector">
              <label>Swarm Role:</label>
              <div className="cli-options">
                <button
                  className={`cli-option ${swarmRole === 'worker' ? 'active' : ''}`}
                  onClick={() => setSwarmRole('worker')}
                >
                  Worker
                </button>
                <button
                  className={`cli-option ${swarmRole === 'lead' ? 'active' : ''}`}
                  onClick={() => setSwarmRole('lead')}
                >
                  Lead
                </button>
              </div>
              {swarmRole === 'lead' && leadSessionId && (
                <div className="warning-text" style={{ marginTop: 8 }}>
                  A lead agent already exists. Launching as lead will demote the current lead to worker.
                </div>
              )}
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
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="secondary-btn" onClick={handleQuickLaunch}>
                  Launch Without Agent
                </button>
              </div>
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
