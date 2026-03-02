import { useState } from 'react';
import type { FunctionalRole, CliType, OfficeSlot, PipelineStage, CronJob, AgentIdentity, Office } from '../types';
import { FUNCTIONAL_ROLE_COLORS, FUNCTIONAL_ROLE_LABELS } from '../types';
import AgentBrowser from './AgentBrowser';

interface Props {
  agents: AgentIdentity[];
  initialOffice?: Office;
  onSave: (name: string, slots: OfficeSlot[], pipeline?: PipelineStage[], context?: { projectPath?: string; soul?: string; memory?: string; instructions?: string; cronJobs?: CronJob[] }) => void;
  onClose: () => void;
}

const ALL_ROLES: FunctionalRole[] = [
  'product-manager', 'architect', 'designer', 'developer', 'tester', 'code-reviewer', 'devops', 'tech-lead',
];

const CLI_OPTIONS: CliType[] = ['claude', 'gemini', 'codex', 'bash'];

const DEFAULT_PIPELINE: PipelineStage[] = [
  { name: 'requirements', description: 'Gather and define requirements', assignedRoles: ['product-manager'] },
  { name: 'design', description: 'Technical architecture and design', assignedRoles: ['architect'] },
  { name: 'implementation', description: 'Write the code', assignedRoles: ['developer'] },
  { name: 'review', description: 'Code review', assignedRoles: ['code-reviewer', 'architect'] },
  { name: 'testing', description: 'Write and run tests', assignedRoles: ['tester'] },
  { name: 'deployment', description: 'Deploy and verify', assignedRoles: ['devops'] },
];

const SCIENTIST_NAMES = [
  'Einstein', 'Newton', 'Darwin', 'Curie', 'Hawking', 'Tesla', 'Galileo',
  'Faraday', 'Pasteur', 'Turing', 'Lovelace', 'Bohr', 'Feynman', 'Planck',
  'Maxwell', 'Dirac', 'Heisenberg', 'Schrödinger', 'Fermi', 'Oppenheimer',
  'Kepler', 'Copernicus', 'Hubble', 'Sagan', 'Rosalind', 'Hopper',
  'Noether', 'Ramanujan', 'Euler', 'Gauss', 'Fibonacci', 'Archimedes',
  'Leibniz', 'Laplace', 'Fourier', 'Bernoulli', 'Cauchy', 'Riemann',
  'Mendeleev', 'Rutherford', 'Chadwick', 'Thomson', 'Kelvin', 'Joule',
  'Watt', 'Ampere', 'Volta', 'Ohm', 'Hertz',
];

function getNextName(currentSlots: OfficeSlot[], existingAgentNames: string[]): string {
  const usedNames = new Set([
    ...currentSlots.map(s => s.name.toLowerCase()),
    ...existingAgentNames.map(n => n.toLowerCase()),
  ]);
  return SCIENTIST_NAMES.find(n => !usedNames.has(n.toLowerCase())) || '';
}

export default function OfficeEditor({ agents, initialOffice, onSave, onClose }: Props) {
  const isEditing = !!initialOffice;
  const existingAgentNames = agents.map(a => a.name);

  const [name, setName] = useState(initialOffice?.name ?? '');
  const [projectPath, setProjectPath] = useState(initialOffice?.projectPath ?? '');
  const [slots, setSlots] = useState<OfficeSlot[]>(
    initialOffice?.slots ?? [{ name: getNextName([], existingAgentNames), functionalRole: 'tech-lead', cliType: 'claude' }],
  );
  const [includePipeline, setIncludePipeline] = useState(initialOffice ? !!initialOffice.pipeline : true);
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null);

  // Team-level context
  const [teamSoul, setTeamSoul] = useState(initialOffice?.soul ?? '');
  const [teamMemory, setTeamMemory] = useState(initialOffice?.memory ?? '');
  const [teamInstructions, setTeamInstructions] = useState(initialOffice?.instructions ?? '');
  const [showTeamContext, setShowTeamContext] = useState(
    !!(initialOffice?.soul || initialOffice?.memory || initialOffice?.instructions)
  );

  const [browsingFolder, setBrowsingFolder] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);

  // Cron jobs state
  const [cronJobs, setCronJobs] = useState<CronJob[]>(initialOffice?.cronJobs ?? []);
  const [showCrons, setShowCrons] = useState((initialOffice?.cronJobs ?? []).length > 0);

  // Per-slot context expand state
  const [expandedSlotContext, setExpandedSlotContext] = useState<number | null>(null);

  // Names already used in the office (for disabling in the picker)
  const usedAgentNames = new Set(slots.map(s => s.name.toLowerCase()));

  function addSlotManual() {
    const nextName = getNextName(slots, existingAgentNames);
    setSlots([...slots, { name: nextName, functionalRole: 'developer', cliType: 'claude' }]);
  }

  function addSlotFromAgent(agent: AgentIdentity) {
    const cliType = (agent.defaultCliType as CliType) || 'claude';
    setSlots([...slots, {
      name: agent.name,
      functionalRole: 'developer',
      cliType,
      soul: agent.soul,
      memory: agent.memory,
      instructions: agent.instructions,
    }]);
    setShowAgentPicker(false);
  }

  function removeSlot(index: number) {
    setSlots(slots.filter((_, i) => i !== index));
  }

  function updateSlot(index: number, field: keyof OfficeSlot, value: string) {
    const updated = [...slots];
    (updated[index] as any)[field] = value;
    setSlots(updated);
  }

  async function handleBrowseFolder() {
    setBrowsingFolder(true);
    try {
      const res = await fetch('/api/project/pick?save=false', { method: 'POST' });
      const data = await res.json();
      if (res.ok && !data.cancelled && typeof data.projectPath === 'string') {
        setProjectPath(data.projectPath);
      }
    } catch {
      // ignore
    } finally {
      setBrowsingFolder(false);
    }
  }

  function handleSave() {
    if (!name.trim()) return;
    if (slots.some(s => !s.name.trim())) return;
    const context = {
      projectPath: projectPath.trim() || undefined,
      soul: teamSoul.trim() || undefined,
      memory: teamMemory.trim() || undefined,
      instructions: teamInstructions.trim() || undefined,
      cronJobs: cronJobs.length > 0 ? cronJobs : undefined,
    };
    onSave(name.trim(), slots, includePipeline ? (initialOffice?.pipeline ?? DEFAULT_PIPELINE) : undefined, context);
  }

  function addCronJob() {
    const id = Math.random().toString(36).slice(2, 10);
    setCronJobs([...cronJobs, {
      id,
      name: '',
      schedule: 'every 30m',
      prompt: '',
      enabled: true,
      createdBy: 'user',
    }]);
  }

  function updateCronJob(index: number, updates: Partial<CronJob>) {
    const updated = [...cronJobs];
    updated[index] = { ...updated[index], ...updates };
    setCronJobs(updated);
  }

  function removeCronJob(index: number) {
    setCronJobs(cronJobs.filter((_, i) => i !== index));
  }

  function getFilteredAgents(slotIndex: number): AgentIdentity[] {
    const currentInput = slots[slotIndex]?.name.toLowerCase() || '';
    const otherSlotNames = new Set(
      slots.filter((_, i) => i !== slotIndex).map(s => s.name.toLowerCase()),
    );
    return agents.filter(a => {
      if (otherSlotNames.has(a.name.toLowerCase())) return false;
      if (currentInput && !a.name.toLowerCase().startsWith(currentInput)) return false;
      return true;
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal office-editor" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEditing ? 'Edit Office' : 'New Office'}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="office-editor-body">
          <div className="office-field">
            <label>Team Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Core Dev Team"
              autoFocus
            />
          </div>

          <div className="office-field">
            <label>Project Folder</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={projectPath}
                onChange={e => setProjectPath(e.target.value)}
                placeholder="Leave empty for global default"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="office-btn"
                onClick={handleBrowseFolder}
                disabled={browsingFolder}
                style={{ whiteSpace: 'nowrap' }}
              >
                {browsingFolder ? 'Choosing...' : 'Browse...'}
              </button>
            </div>
          </div>

          <div className="office-field">
            <button
              type="button"
              className="office-context-toggle"
              onClick={() => setShowTeamContext(!showTeamContext)}
            >
              <svg
                width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
                style={{ transform: showTeamContext ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
              >
                <path d="M6 3.5l4.5 4.5L6 12.5V3.5z"/>
              </svg>
              Team Context
              {(teamSoul || teamMemory || teamInstructions) && (
                <span className="office-context-indicator" />
              )}
            </button>
            {showTeamContext && (
              <div className="office-context-fields">
                <div className="office-context-field">
                  <label>Soul / Persona</label>
                  <textarea
                    className="office-context-textarea"
                    value={teamSoul}
                    onChange={e => setTeamSoul(e.target.value)}
                    placeholder="Describe the team's shared personality, tone, and character..."
                    rows={3}
                  />
                </div>
                <div className="office-context-field">
                  <label>Memory</label>
                  <textarea
                    className="office-context-textarea"
                    value={teamMemory}
                    onChange={e => setTeamMemory(e.target.value)}
                    placeholder="Shared knowledge, facts, and context the team should remember..."
                    rows={3}
                  />
                </div>
                <div className="office-context-field">
                  <label>Instructions</label>
                  <textarea
                    className="office-context-textarea"
                    value={teamInstructions}
                    onChange={e => setTeamInstructions(e.target.value)}
                    placeholder="Team-wide behavioral rules, constraints, and directives..."
                    rows={3}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="office-field">
            <label>Team Members</label>
            <div className="office-slots-list">
              {slots.map((slot, i) => {
                const filteredAgents = getFilteredAgents(i);
                const hasSlotContext = !!(slot.soul || slot.memory || slot.instructions);
                return (
                  <div key={i} className="office-slot-row-group">
                    <div className="office-slot-row">
                      <div className="office-slot-name-wrapper">
                        <input
                          type="text"
                          value={slot.name}
                          onChange={e => updateSlot(i, 'name', e.target.value)}
                          onFocus={() => setFocusedSlot(i)}
                          onBlur={() => setTimeout(() => setFocusedSlot(null), 200)}
                          placeholder="Agent name"
                          className="office-slot-name"
                        />
                        {focusedSlot === i && filteredAgents.length > 0 && (
                          <div className="office-slot-suggestions">
                            {filteredAgents.map(agent => (
                              <button key={agent.id} onMouseDown={() => updateSlot(i, 'name', agent.name)}>
                                <span>{agent.name}</span>
                                <span className="suggestion-email">{agent.email}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <select
                        value={slot.functionalRole}
                        onChange={e => updateSlot(i, 'functionalRole', e.target.value)}
                        className="office-slot-role"
                        style={{ borderColor: FUNCTIONAL_ROLE_COLORS[slot.functionalRole] + '66' }}
                      >
                        {ALL_ROLES.map(role => (
                          <option key={role} value={role}>{FUNCTIONAL_ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                      <select
                        value={slot.cliType}
                        onChange={e => updateSlot(i, 'cliType', e.target.value)}
                        className="office-slot-cli"
                      >
                        {CLI_OPTIONS.map(cli => (
                          <option key={cli} value={cli}>{cli.toUpperCase()}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={`office-slot-context-btn ${hasSlotContext ? 'has-context' : ''}`}
                        onClick={() => setExpandedSlotContext(expandedSlotContext === i ? null : i)}
                        title="Agent context (soul, memory, instructions)"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM6.5 7h3v5h-3V7z"/>
                        </svg>
                      </button>
                      {slots.length > 1 && (
                        <button className="office-slot-remove" onClick={() => removeSlot(i)}>&times;</button>
                      )}
                    </div>
                    {expandedSlotContext === i && (
                      <div className="office-slot-context">
                        <div className="office-context-field">
                          <label>Soul / Persona (overrides team)</label>
                          <textarea
                            className="office-context-textarea"
                            value={slot.soul || ''}
                            onChange={e => updateSlot(i, 'soul', e.target.value)}
                            placeholder="This agent's unique personality..."
                            rows={2}
                          />
                        </div>
                        <div className="office-context-field">
                          <label>Memory (added to team memory)</label>
                          <textarea
                            className="office-context-textarea"
                            value={slot.memory || ''}
                            onChange={e => updateSlot(i, 'memory', e.target.value)}
                            placeholder="Agent-specific knowledge..."
                            rows={2}
                          />
                        </div>
                        <div className="office-context-field">
                          <label>Instructions (added to team instructions)</label>
                          <textarea
                            className="office-context-textarea"
                            value={slot.instructions || ''}
                            onChange={e => updateSlot(i, 'instructions', e.target.value)}
                            placeholder="Agent-specific directives..."
                            rows={2}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="office-btn primary" onClick={() => setShowAgentPicker(true)}>+ Add Existing Agent</button>
              <button className="office-btn" onClick={addSlotManual}>+ Add Blank Slot</button>
            </div>
          </div>

          <div className="office-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={includePipeline}
                onChange={e => setIncludePipeline(e.target.checked)}
              />
              Include default pipeline (requirements → design → implementation → review → testing → deployment)
            </label>
          </div>

          {/* Scheduled Tasks (Cron Jobs) */}
          <div className="cron-editor-section">
            <button
              type="button"
              className="cron-editor-toggle"
              onClick={() => setShowCrons(!showCrons)}
            >
              <svg
                width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
                style={{ transform: showCrons ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
              >
                <path d="M6 3.5l4.5 4.5L6 12.5V3.5z"/>
              </svg>
              Scheduled Tasks
              {cronJobs.length > 0 && (
                <span style={{ fontSize: 11, color: '#565f89', fontWeight: 400 }}>
                  ({cronJobs.length})
                </span>
              )}
            </button>

            {showCrons && (
              <div className="cron-job-list">
                {cronJobs.map((job, i) => (
                  <div key={job.id} className="cron-job-card">
                    <div className="cron-job-card-header">
                      <input
                        type="text"
                        className="cron-job-name-input"
                        value={job.name}
                        onChange={e => updateCronJob(i, { name: e.target.value })}
                        placeholder="Job name (e.g. Context refresh)"
                      />
                      <button
                        type="button"
                        className={`cron-job-enabled-toggle ${job.enabled ? 'on' : 'off'}`}
                        onClick={() => updateCronJob(i, { enabled: !job.enabled })}
                        title={job.enabled ? 'Enabled' : 'Disabled'}
                      />
                      <button
                        type="button"
                        className="cron-job-remove"
                        onClick={() => removeCronJob(i)}
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="cron-job-fields">
                      <div className="cron-job-field">
                        <label>Schedule</label>
                        <input
                          type="text"
                          value={job.schedule}
                          onChange={e => updateCronJob(i, { schedule: e.target.value })}
                          placeholder="every 30m"
                        />
                      </div>
                      <div className="cron-job-field">
                        <label>Target</label>
                        <select
                          value={job.targetAgent || job.targetRole || '_all'}
                          onChange={e => {
                            const val = e.target.value;
                            if (val === '_all') {
                              updateCronJob(i, { targetAgent: undefined, targetRole: undefined });
                            } else if (ALL_ROLES.includes(val as FunctionalRole)) {
                              updateCronJob(i, { targetAgent: undefined, targetRole: val as FunctionalRole });
                            } else {
                              updateCronJob(i, { targetAgent: val, targetRole: undefined });
                            }
                          }}
                        >
                          <option value="_all">All agents</option>
                          <optgroup label="By Role">
                            {ALL_ROLES.map(role => (
                              <option key={role} value={role}>{FUNCTIONAL_ROLE_LABELS[role]}</option>
                            ))}
                          </optgroup>
                          {slots.length > 0 && (
                            <optgroup label="By Agent">
                              {slots.map(slot => (
                                <option key={slot.name} value={slot.name}>{slot.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                      <div className="cron-job-field cron-job-prompt">
                        <label>Prompt</label>
                        <textarea
                          value={job.prompt}
                          onChange={e => updateCronJob(i, { prompt: e.target.value })}
                          placeholder="Message to inject into agent terminal..."
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <button className="office-btn" onClick={addCronJob} style={{ alignSelf: 'flex-start' }}>
                  + Add Scheduled Task
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="office-btn" onClick={onClose}>Cancel</button>
          <button
            className="office-btn primary"
            onClick={handleSave}
            disabled={!name.trim() || slots.some(s => !s.name.trim())}
          >
            {isEditing ? 'Save Changes' : 'Create Office'}
          </button>
        </div>
      </div>

      {showAgentPicker && (
        <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={() => setShowAgentPicker(false)}>
          <div className="modal" style={{ maxWidth: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Agent to Office</h3>
              <button className="modal-close" onClick={() => setShowAgentPicker(false)}>&times;</button>
            </div>
            <div style={{ padding: '12px 20px', overflow: 'auto', flex: 1 }}>
              {agents.length > 0 ? (
                <AgentBrowser
                  agents={agents}
                  onSelect={addSlotFromAgent}
                  disabledIds={usedAgentNames}
                  compact
                />
              ) : (
                <p style={{ color: '#565f89', textAlign: 'center', padding: '24px 0' }}>
                  No agent identities yet. Use "Add Blank Slot" to create members with new names.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
