import type { CliType, AgentIdentity } from '../types';

interface HeaderProps {
  sessionCount: number;
  connected: boolean;
  onAddTerminal: () => void;
}

export default function Header({ sessionCount, connected, onAddTerminal }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">Agent Swarm</h1>
        <span className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} />
      </div>
      <div className="header-right">
        <span className="session-count">{sessionCount} session{sessionCount !== 1 ? 's' : ''}</span>
        <button className="add-btn" onClick={onAddTerminal}>
          + Add Agent
        </button>
      </div>
    </header>
  );
}
