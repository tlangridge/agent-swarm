import { useState, useRef, useEffect } from 'react';

type BroadcastTarget = 'all' | 'lead';

interface BroadcastBarProps {
  sessionCount: number;
  leadSessionId: string | null;
  leadAgentName: string | null;
  onBroadcast: (text: string) => void;
  onSendToLead: (text: string) => void;
}

export default function BroadcastBar({ sessionCount, leadSessionId, leadAgentName, onBroadcast, onSendToLead }: BroadcastBarProps) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<BroadcastTarget>(leadSessionId ? 'lead' : 'all');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Switch to 'all' if lead disappears while targeting lead
  useEffect(() => {
    if (!leadSessionId && target === 'lead') {
      setTarget('all');
    }
  }, [leadSessionId, target]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sessionCount === 0) return;
    if (target === 'lead' && leadSessionId) {
      onSendToLead(trimmed);
    } else {
      onBroadcast(trimmed);
    }
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const leadLabel = leadAgentName ? `Lead: ${leadAgentName}` : 'Lead';

  return (
    <div className="broadcast-bar">
      <div className="broadcast-label-row">
        <div className="broadcast-target-toggle">
          <button
            className={`broadcast-target-btn ${target === 'lead' ? 'active' : ''}`}
            onClick={() => setTarget('lead')}
            disabled={!leadSessionId}
            title={leadSessionId ? `Send to ${leadAgentName || 'lead agent'}` : 'No lead agent designated'}
          >
            {leadLabel}
          </button>
          <button
            className={`broadcast-target-btn ${target === 'all' ? 'active' : ''}`}
            onClick={() => setTarget('all')}
          >
            All ({sessionCount})
          </button>
        </div>
      </div>
      <div className="broadcast-input-row">
        <textarea
          ref={inputRef}
          className="broadcast-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={sessionCount === 0 ? 'No active sessions...' : target === 'lead' ? `Message ${leadAgentName || 'lead'}...` : 'Broadcast to all agents...'}
          disabled={sessionCount === 0}
          rows={1}
        />
        <button
          className="broadcast-send-btn"
          onClick={handleSend}
          disabled={!text.trim() || sessionCount === 0}
        >
          {target === 'lead' ? 'Send' : 'Send All'}
        </button>
      </div>
    </div>
  );
}
