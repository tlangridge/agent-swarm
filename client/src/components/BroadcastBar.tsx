import { useState, useRef } from 'react';

interface BroadcastBarProps {
  sessionCount: number;
  onBroadcast: (text: string) => void;
}

export default function BroadcastBar({ sessionCount, onBroadcast }: BroadcastBarProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sessionCount === 0) return;
    onBroadcast(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="broadcast-bar">
      <div className="broadcast-label">
        Broadcast to all ({sessionCount})
      </div>
      <div className="broadcast-input-row">
        <textarea
          ref={inputRef}
          className="broadcast-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={sessionCount === 0 ? 'No active sessions...' : 'Type a message and press Enter to send to all agents...'}
          disabled={sessionCount === 0}
          rows={1}
        />
        <button
          className="broadcast-send-btn"
          onClick={handleSend}
          disabled={!text.trim() || sessionCount === 0}
        >
          Send All
        </button>
      </div>
    </div>
  );
}
