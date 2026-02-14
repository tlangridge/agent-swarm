import { useState, useEffect, useRef } from 'react';

interface HeaderProps {
  sessionCount: number;
  connected: boolean;
  projectPath: string;
  projectPathValid: boolean | null;
  pickingProjectPath: boolean;
  onAddTerminal: () => void;
  onOpenSettings: () => void;
  onSetProjectPath: (path: string) => void;
  onPickProjectPath: () => void;
}

export default function Header({
  sessionCount,
  connected,
  projectPath,
  projectPathValid,
  pickingProjectPath,
  onAddTerminal,
  onOpenSettings,
  onSetProjectPath,
  onPickProjectPath,
}: HeaderProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(projectPath);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(projectPath);
  }, [projectPath]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleSubmit = () => {
    setEditing(false);
    const trimmed = inputValue.trim();
    if (trimmed !== projectPath) {
      onSetProjectPath(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setInputValue(projectPath);
      setEditing(false);
    }
  };

  const handleBrowseClick = () => {
    setEditing(false);
    onPickProjectPath();
  };

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">Agent Swarm</h1>
        <span className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} />
      </div>

      <div className="header-center">
        <div className="project-path-display">
          {editing ? (
            <input
              ref={inputRef}
              className="project-path-input"
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onBlur={handleSubmit}
              onKeyDown={handleKeyDown}
              placeholder="/path/to/your/project"
              spellCheck={false}
            />
          ) : (
            <button
              className="project-path-main"
              onClick={() => setEditing(true)}
              title={projectPath || 'Click to set project path'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
              </svg>
              <span className="project-path-text">
                {projectPath || 'Set project path...'}
              </span>
              {projectPath && projectPathValid !== null && (
                <span className={`project-path-status ${projectPathValid ? 'valid' : 'invalid'}`}>
                  {projectPathValid ? '\u2713' : '\u2717'}
                </span>
              )}
            </button>
          )}

          <button
            className="project-path-browse-btn"
            onMouseDown={e => e.preventDefault()}
            onClick={handleBrowseClick}
            disabled={pickingProjectPath}
            title="Choose project folder"
          >
            {pickingProjectPath ? 'Choosing...' : 'Browse...'}
          </button>
        </div>
      </div>

      <div className="header-right">
        <span className="session-count">{sessionCount} session{sessionCount !== 1 ? 's' : ''}</span>
        <button className="add-btn" onClick={onAddTerminal}>
          + Add Agent
        </button>
        <button className="settings-btn" onClick={onOpenSettings} title="Settings">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.902 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.892 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.892-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.116l.094-.318z"/>
          </svg>
        </button>
      </div>
    </header>
  );
}
