import { useState } from 'react';
import type { AgentIdentity } from '../types';
import { avatarColor, avatarInitials } from '../utils/agent-avatar';

export type AgentBrowserViewMode = 'grid' | 'list';

interface Props {
  agents: AgentIdentity[];
  /** If provided, renders in selection mode with a callback on pick */
  onSelect?: (agent: AgentIdentity) => void;
  /** Agents to dim / mark as already-added (e.g. current office members) */
  disabledIds?: Set<string>;
  /** Called when clicking an agent in browse (non-select) mode */
  onClickAgent?: (agent: AgentIdentity) => void;
  /** Override initial view mode */
  initialViewMode?: AgentBrowserViewMode;
  /** Show the grid/list toggle (default true) */
  showViewToggle?: boolean;
  /** Compact sizing for embedding inside dialogs */
  compact?: boolean;
}

function ViewToggle({ viewMode, setViewMode }: { viewMode: AgentBrowserViewMode; setViewMode: (m: AgentBrowserViewMode) => void }) {
  return (
    <div className="agent-view-toggle">
      <button
        className={`agent-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
        onClick={() => setViewMode('grid')}
        title="Grid view"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/>
        </svg>
      </button>
      <button
        className={`agent-view-btn ${viewMode === 'list' ? 'active' : ''}`}
        onClick={() => setViewMode('list')}
        title="List view"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
        </svg>
      </button>
    </div>
  );
}

function EmailDisplay({ email }: { email: string }) {
  if (email) {
    return (
      <div className="agent-card-email">
        <span className="agent-card-email-dot provisioned" />
        <span>{email}</span>
      </div>
    );
  }
  return (
    <div className="agent-card-email">
      <span className="agent-card-email-dot none" />
      <span style={{ color: '#e0af68' }}>No email</span>
    </div>
  );
}

function GridCard({ agent, disabled, onClick, compact }: { agent: AgentIdentity; disabled?: boolean; onClick: () => void; compact?: boolean }) {
  const color = avatarColor(agent.name);
  return (
    <button
      className={`agent-card agent-card-grid ${disabled ? 'agent-card-disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      style={compact ? { padding: '14px 12px 12px' } : undefined}
      disabled={disabled}
    >
      <div
        className={`agent-avatar ${compact ? 'agent-avatar-sm' : 'agent-avatar-lg'}`}
        style={{ backgroundColor: color + '22', color }}
      >
        {avatarInitials(agent.name)}
      </div>
      <div className="agent-card-name">{agent.name}</div>
      <span className="agent-card-cli">{(agent.defaultCliType || 'claude').toUpperCase()}</span>
      <EmailDisplay email={agent.email} />
      {disabled && <span className="agent-card-tag-added">Already added</span>}
    </button>
  );
}

function ListRow({ agent, disabled, onClick }: { agent: AgentIdentity; disabled?: boolean; onClick: () => void }) {
  const color = avatarColor(agent.name);
  return (
    <button
      className={`agent-card agent-card-row ${disabled ? 'agent-card-disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className="agent-avatar agent-avatar-sm" style={{ backgroundColor: color + '22', color }}>
        {avatarInitials(agent.name)}
      </div>
      <div className="agent-row-info">
        <div className="agent-row-top">
          <span className="agent-card-name">{agent.name}</span>
          <span className="agent-card-cli">{(agent.defaultCliType || 'claude').toUpperCase()}</span>
        </div>
        <EmailDisplay email={agent.email} />
      </div>
      <div className="agent-row-end">
        {disabled ? (
          <span className="agent-card-tag-added">Added</span>
        ) : (
          <span className="agent-card-meta">
            {new Date(agent.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
      </div>
    </button>
  );
}

export default function AgentBrowser({ agents, onSelect, disabledIds, onClickAgent, initialViewMode = 'grid', showViewToggle = true, compact }: Props) {
  const [viewMode, setViewMode] = useState<AgentBrowserViewMode>(initialViewMode);
  const [search, setSearch] = useState('');

  const filtered = agents.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleClick = (agent: AgentIdentity) => {
    if (onSelect) onSelect(agent);
    else if (onClickAgent) onClickAgent(agent);
  };

  if (agents.length === 0) {
    return (
      <div className="agent-browser-empty">
        <p style={{ color: '#565f89' }}>No agent identities yet.</p>
      </div>
    );
  }

  return (
    <div className="agent-browser">
      <div className="agent-browser-toolbar">
        <input
          className="agent-browser-search"
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          spellCheck={false}
        />
        {showViewToggle && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />}
      </div>
      <div className={viewMode === 'grid' ? 'agent-card-grid-container' : 'agent-card-list'}>
        {filtered.map(agent => {
          const disabled = disabledIds?.has(agent.id) || disabledIds?.has(agent.name.toLowerCase());
          return viewMode === 'grid'
            ? <GridCard key={agent.id} agent={agent} disabled={disabled} onClick={() => handleClick(agent)} compact={compact} />
            : <ListRow key={agent.id} agent={agent} disabled={disabled} onClick={() => handleClick(agent)} />;
        })}
        {filtered.length === 0 && (
          <p style={{ color: '#565f89', padding: '8px 0', fontSize: 13 }}>No agents match "{search}"</p>
        )}
      </div>
    </div>
  );
}
