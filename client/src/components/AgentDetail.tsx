import { useState } from 'react';
import type { AgentIdentity, CliType, Office, OfficeSlot } from '../types';
import { FUNCTIONAL_ROLE_LABELS, FUNCTIONAL_ROLE_COLORS } from '../types';
import { avatarColor, avatarInitials } from '../utils/agent-avatar';

interface Props {
  agent: AgentIdentity;
  offices: Office[];
  onUpdate: (id: string, updates: Partial<Pick<AgentIdentity, 'name' | 'defaultCliType' | 'soul' | 'memory' | 'instructions'>>) => Promise<AgentIdentity | null>;
  onDelete: (id: string) => Promise<boolean>;
  onUpdateOffice: (id: string, updates: Partial<Pick<Office, 'name' | 'slots' | 'pipeline' | 'cronJobs' | 'soul' | 'memory' | 'instructions'>>) => Promise<void>;
  onBack: () => void;
}

const CLI_OPTIONS: { value: CliType; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'bash', label: 'Bash' },
];

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function AgentDetail({ agent, offices, onUpdate, onDelete, onUpdateOffice, onBack }: Props) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(agent.name);
  const [editCli, setEditCli] = useState(agent.defaultCliType || 'claude');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Office context editing state
  const [editingOfficeId, setEditingOfficeId] = useState<string | null>(null);
  const [editOfficeSoul, setEditOfficeSoul] = useState('');
  const [editOfficeMemory, setEditOfficeMemory] = useState('');
  const [editOfficeInstructions, setEditOfficeInstructions] = useState('');
  const [editSlotSoul, setEditSlotSoul] = useState('');
  const [editSlotMemory, setEditSlotMemory] = useState('');
  const [editSlotInstructions, setEditSlotInstructions] = useState('');
  const [savingContext, setSavingContext] = useState(false);

  // Agent innate context editing state
  const [editingAgentContext, setEditingAgentContext] = useState(false);
  const [editAgentSoul, setEditAgentSoul] = useState('');
  const [editAgentMemory, setEditAgentMemory] = useState('');
  const [editAgentInstructions, setEditAgentInstructions] = useState('');
  const [savingAgentContext, setSavingAgentContext] = useState(false);

  const color = avatarColor(agent.name);

  const startEdit = () => {
    setEditName(agent.name);
    setEditCli(agent.defaultCliType || 'claude');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    await onUpdate(agent.id, { name: editName.trim(), defaultCliType: editCli });
    setSaving(false);
    setEditing(false);
  };

  const handleDelete = async () => {
    const msg = agent.email
      ? `Delete "${agent.name}"? This will also destroy their AgentMail inbox (${agent.email}).`
      : `Delete "${agent.name}"?`;
    if (!window.confirm(msg)) return;
    const ok = await onDelete(agent.id);
    if (ok) onBack();
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(field);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const startAgentContextEdit = () => {
    setEditAgentSoul(agent.soul || '');
    setEditAgentMemory(agent.memory || '');
    setEditAgentInstructions(agent.instructions || '');
    setEditingAgentContext(true);
  };

  const cancelAgentContextEdit = () => {
    setEditingAgentContext(false);
  };

  const saveAgentContext = async () => {
    setSavingAgentContext(true);
    await onUpdate(agent.id, {
      soul: editAgentSoul.trim() || null,
      memory: editAgentMemory.trim() || null,
      instructions: editAgentInstructions.trim() || null,
    } as any);
    setSavingAgentContext(false);
    setEditingAgentContext(false);
  };

  const startContextEdit = (office: Office, slot: OfficeSlot) => {
    setEditingOfficeId(office.id);
    setEditOfficeSoul(office.soul || '');
    setEditOfficeMemory(office.memory || '');
    setEditOfficeInstructions(office.instructions || '');
    setEditSlotSoul(slot.soul || '');
    setEditSlotMemory(slot.memory || '');
    setEditSlotInstructions(slot.instructions || '');
  };

  const cancelContextEdit = () => {
    setEditingOfficeId(null);
  };

  const saveContextEdit = async (office: Office) => {
    setSavingContext(true);
    const updatedSlots = office.slots.map(s => {
      if (s.name.toLowerCase() === agent.name.toLowerCase()) {
        return {
          ...s,
          soul: editSlotSoul.trim() || null,
          memory: editSlotMemory.trim() || null,
          instructions: editSlotInstructions.trim() || null,
        };
      }
      return s;
    });
    await onUpdateOffice(office.id, {
      slots: updatedSlots,
      soul: editOfficeSoul.trim() || null,
      memory: editOfficeMemory.trim() || null,
      instructions: editOfficeInstructions.trim() || null,
    } as any);
    setSavingContext(false);
    setEditingOfficeId(null);
  };

  const credentialEntries = Object.entries(agent.credentials || {});

  // Find office assignments
  const assignments: { office: Office; slot: OfficeSlot }[] = [];
  for (const o of offices) {
    const slot = o.slots.find(s => s.name.toLowerCase() === agent.name.toLowerCase());
    if (slot) assignments.push({ office: o, slot });
  }

  return (
    <div className="agent-detail">
      <div className="agent-detail-header">
        <div className="agent-avatar agent-avatar-xl" style={{ backgroundColor: color + '22', color }}>
          {avatarInitials(agent.name)}
        </div>
        <div className="agent-detail-header-info">
          {editing ? (
            <input
              className="agent-detail-name-input"
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              autoFocus
              disabled={saving}
            />
          ) : (
            <h3 className="agent-detail-name">{agent.name}</h3>
          )}
          <div className="agent-detail-id">
            <span className="agent-detail-id-value">{agent.id}</span>
            <button
              className="agent-detail-copy-btn"
              onClick={() => copyToClipboard(agent.id, 'id')}
              title="Copy ID"
            >
              {copied === 'id' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="agent-detail-header-actions">
          {editing ? (
            <>
              <button className="office-btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
              <button className="office-btn primary" onClick={saveEdit} disabled={!editName.trim() || saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button className="office-btn" onClick={startEdit}>Edit</button>
              <button className="office-btn danger-text" onClick={handleDelete}>Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="agent-detail-fields">
        <div className="agent-detail-field">
          <label>Default CLI</label>
          {editing ? (
            <div className="cli-options">
              {CLI_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`cli-option ${editCli === opt.value ? 'active' : ''}`}
                  onClick={() => setEditCli(opt.value)}
                  disabled={saving}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="agent-detail-field-value">
              <span className="agent-card-cli">{(agent.defaultCliType || 'claude').toUpperCase()}</span>
            </div>
          )}
        </div>

        <div className="agent-detail-field">
          <label>Email</label>
          <div className="agent-detail-field-value">
            {agent.email ? (
              <div className="agent-detail-email-row">
                <span className="agent-card-email-dot provisioned" />
                <span>{agent.email}</span>
                <button
                  className="agent-detail-copy-btn"
                  onClick={() => copyToClipboard(agent.email, 'email')}
                  title="Copy email"
                >
                  {copied === 'email' ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <div className="agent-detail-email-row">
                <span className="agent-card-email-dot none" />
                <span className="agent-detail-muted">No email provisioned</span>
              </div>
            )}
          </div>
        </div>

        <div className="agent-detail-field">
          <label>Inbox ID</label>
          <div className="agent-detail-field-value">
            {agent.inboxId ? (
              <div className="agent-detail-email-row">
                <span>{agent.inboxId}</span>
                <button
                  className="agent-detail-copy-btn"
                  onClick={() => copyToClipboard(agent.inboxId, 'inboxId')}
                  title="Copy inbox ID"
                >
                  {copied === 'inboxId' ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <span className="agent-detail-muted">None</span>
            )}
          </div>
        </div>

        <div className="agent-detail-field">
          <label>Credentials</label>
          <div className="agent-detail-field-value">
            {credentialEntries.length > 0 ? (
              <div className="agent-detail-credentials">
                {credentialEntries.map(([key, value]) => (
                  <div key={key} className="agent-detail-credential-row">
                    <span className="agent-detail-credential-key">{key}</span>
                    <span className="agent-detail-credential-value">{value}</span>
                    <button
                      className="agent-detail-copy-btn"
                      onClick={() => copyToClipboard(value, `cred-${key}`)}
                      title={`Copy ${key}`}
                    >
                      {copied === `cred-${key}` ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <span className="agent-detail-muted">No credentials stored</span>
            )}
          </div>
        </div>

        <div className="agent-detail-field-row">
          <div className="agent-detail-field">
            <label>Created</label>
            <div className="agent-detail-field-value">
              {formatTimestamp(agent.createdAt)}
            </div>
          </div>
          <div className="agent-detail-field">
            <label>Updated</label>
            <div className="agent-detail-field-value">
              {formatTimestamp(agent.updatedAt)}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Context — always visible */}
      <div className="agent-detail-office-section">
        <h4>Agent Context</h4>
        <div className="agent-detail-office-card">
          <div className="agent-detail-office-card-header">
            <span className="agent-detail-office-name">Soul / Memory / Instructions</span>
            {!editingAgentContext && (
              <button
                className="office-btn"
                style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }}
                onClick={startAgentContextEdit}
              >
                Edit Context
              </button>
            )}
          </div>

          {editingAgentContext ? (
            <div className="agent-detail-office-edit-section">
              <div className="office-context-field">
                <label>Soul / Persona</label>
                <textarea
                  className="office-context-textarea"
                  value={editAgentSoul}
                  onChange={e => setEditAgentSoul(e.target.value)}
                  placeholder="This agent's innate personality, tone, and character..."
                  rows={3}
                  disabled={savingAgentContext}
                />
              </div>
              <div className="office-context-field">
                <label>Memory</label>
                <textarea
                  className="office-context-textarea"
                  value={editAgentMemory}
                  onChange={e => setEditAgentMemory(e.target.value)}
                  placeholder="Persistent knowledge and context this agent always carries..."
                  rows={3}
                  disabled={savingAgentContext}
                />
              </div>
              <div className="office-context-field">
                <label>Instructions</label>
                <textarea
                  className="office-context-textarea"
                  value={editAgentInstructions}
                  onChange={e => setEditAgentInstructions(e.target.value)}
                  placeholder="Standing directives this agent always follows..."
                  rows={3}
                  disabled={savingAgentContext}
                />
              </div>
              <div className="agent-detail-office-edit-actions">
                <button className="office-btn" onClick={cancelAgentContextEdit} disabled={savingAgentContext}>Cancel</button>
                <button className="office-btn primary" onClick={saveAgentContext} disabled={savingAgentContext}>
                  {savingAgentContext ? 'Saving...' : 'Save Context'}
                </button>
              </div>
            </div>
          ) : (
            (agent.soul || agent.memory || agent.instructions) ? (
              <div className="agent-detail-office-context">
                {agent.soul && (
                  <div className="agent-detail-office-context-field">
                    <label>Soul</label>
                    <div className="agent-detail-office-context-value">{agent.soul}</div>
                  </div>
                )}
                {agent.memory && (
                  <div className="agent-detail-office-context-field">
                    <label>Memory</label>
                    <div className="agent-detail-office-context-value">{agent.memory}</div>
                  </div>
                )}
                {agent.instructions && (
                  <div className="agent-detail-office-context-field">
                    <label>Instructions</label>
                    <div className="agent-detail-office-context-value">{agent.instructions}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="agent-detail-muted" style={{ fontSize: 12, marginTop: 4 }}>No context configured</div>
            )
          )}
        </div>
      </div>

      {/* Office Assignments */}
      {assignments.length > 0 && (
        <div className="agent-detail-office-section">
          <h4>Office Assignments</h4>
          {assignments.map(({ office, slot }) => {
            const isEditingThis = editingOfficeId === office.id;
            const effectiveSoul = slot.soul || office.soul || agent.soul;
            const memoryParts = [agent.memory, office.memory, slot.memory].filter(Boolean);
            const instrParts = [agent.instructions, office.instructions, slot.instructions].filter(Boolean);

            return (
              <div key={office.id} className="agent-detail-office-card">
                <div className="agent-detail-office-card-header">
                  <span className="agent-detail-office-name">{office.name}</span>
                  <span
                    className="agent-detail-office-role"
                    style={{
                      backgroundColor: FUNCTIONAL_ROLE_COLORS[slot.functionalRole] + '22',
                      color: FUNCTIONAL_ROLE_COLORS[slot.functionalRole],
                      border: `1px solid ${FUNCTIONAL_ROLE_COLORS[slot.functionalRole]}44`,
                    }}
                  >
                    {FUNCTIONAL_ROLE_LABELS[slot.functionalRole]}
                  </span>
                  {!isEditingThis && (
                    <button
                      className="office-btn"
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }}
                      onClick={() => startContextEdit(office, slot)}
                    >
                      Edit Context
                    </button>
                  )}
                </div>

                {isEditingThis ? (
                  <div className="agent-detail-office-edit-section">
                    <div className="agent-detail-office-edit-group">
                      <h5>Team Context <span className="agent-detail-muted">(shared across team)</span></h5>
                      <div className="office-context-field">
                        <label>Soul / Persona</label>
                        <textarea
                          className="office-context-textarea"
                          value={editOfficeSoul}
                          onChange={e => setEditOfficeSoul(e.target.value)}
                          placeholder="Team personality, tone, and character..."
                          rows={3}
                          disabled={savingContext}
                        />
                      </div>
                      <div className="office-context-field">
                        <label>Memory</label>
                        <textarea
                          className="office-context-textarea"
                          value={editOfficeMemory}
                          onChange={e => setEditOfficeMemory(e.target.value)}
                          placeholder="Shared knowledge and context..."
                          rows={3}
                          disabled={savingContext}
                        />
                      </div>
                      <div className="office-context-field">
                        <label>Instructions</label>
                        <textarea
                          className="office-context-textarea"
                          value={editOfficeInstructions}
                          onChange={e => setEditOfficeInstructions(e.target.value)}
                          placeholder="Team-wide rules and directives..."
                          rows={3}
                          disabled={savingContext}
                        />
                      </div>
                    </div>
                    <div className="agent-detail-office-edit-group">
                      <h5>Slot Context <span className="agent-detail-muted">(overrides agent innate in this office)</span></h5>
                      <div className="office-context-field">
                        <label>Soul / Persona (overrides agent + team)</label>
                        <textarea
                          className="office-context-textarea"
                          value={editSlotSoul}
                          onChange={e => setEditSlotSoul(e.target.value)}
                          placeholder="Override personality for this office..."
                          rows={2}
                          disabled={savingContext}
                        />
                      </div>
                      <div className="office-context-field">
                        <label>Memory (added to agent + team memory)</label>
                        <textarea
                          className="office-context-textarea"
                          value={editSlotMemory}
                          onChange={e => setEditSlotMemory(e.target.value)}
                          placeholder="Office-specific knowledge..."
                          rows={2}
                          disabled={savingContext}
                        />
                      </div>
                      <div className="office-context-field">
                        <label>Instructions (added to agent + team instructions)</label>
                        <textarea
                          className="office-context-textarea"
                          value={editSlotInstructions}
                          onChange={e => setEditSlotInstructions(e.target.value)}
                          placeholder="Office-specific directives..."
                          rows={2}
                          disabled={savingContext}
                        />
                      </div>
                    </div>
                    <div className="agent-detail-office-edit-actions">
                      <button className="office-btn" onClick={cancelContextEdit} disabled={savingContext}>Cancel</button>
                      <button className="office-btn primary" onClick={() => saveContextEdit(office)} disabled={savingContext}>
                        {savingContext ? 'Saving...' : 'Save Context'}
                      </button>
                    </div>
                  </div>
                ) : (
                  (effectiveSoul || memoryParts.length > 0 || instrParts.length > 0) ? (
                    <div className="agent-detail-office-context">
                      {effectiveSoul && (
                        <div className="agent-detail-office-context-field">
                          <label>Soul{slot.soul ? '' : office.soul ? ' (team)' : ' (agent innate)'}</label>
                          <div className="agent-detail-office-context-value">{effectiveSoul}</div>
                        </div>
                      )}
                      {memoryParts.length > 0 && (
                        <div className="agent-detail-office-context-field">
                          <label>Memory</label>
                          <div className="agent-detail-office-context-value">{memoryParts.join('\n\n')}</div>
                        </div>
                      )}
                      {instrParts.length > 0 && (
                        <div className="agent-detail-office-context-field">
                          <label>Instructions</label>
                          <div className="agent-detail-office-context-value">{instrParts.join('\n\n')}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="agent-detail-muted" style={{ fontSize: 12, marginTop: 4 }}>No context configured</div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
