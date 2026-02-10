import type { TerminalSession } from '../types';

interface TerminalTileProps {
  session: TerminalSession;
}

export default function TerminalTile({ session }: TerminalTileProps) {
  const cliLabels: Record<string, string> = {
    bash: 'Bash',
    claude: 'Claude',
    gemini: 'Gemini',
    codex: 'Codex',
    opencode: 'OpenCode',
  };

  return (
    <span className="tile-title-content">
      <span className="tile-cli-badge">{cliLabels[session.cliType] || session.cliType}</span>
      {session.agentName && (
        <span className="tile-agent-name">{session.agentName}</span>
      )}
      {session.agentEmail && (
        <span className="tile-agent-email">{session.agentEmail}</span>
      )}
    </span>
  );
}
