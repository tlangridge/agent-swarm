import { useState, useRef, useEffect } from 'react';

type BroadcastTarget = 'all' | 'direct';

interface BroadcastBarProps {
  sessionCount: number;
  targetSessionId: string | null;
  targetLabel: string | null;
  onBroadcast: (text: string) => void;
  onSendToSession: (sessionId: string, text: string) => void;
  officeName?: string;
}

export default function BroadcastBar({
  sessionCount,
  targetSessionId,
  targetLabel,
  onBroadcast,
  onSendToSession,
  officeName,
}: BroadcastBarProps) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<BroadcastTarget>(targetSessionId ? 'direct' : 'all');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevTargetSessionIdRef = useRef<string | null>(targetSessionId);

  // Auto-select direct target when the direct recipient changes (e.g. focus switch),
  // but allow manual "All" selection while the recipient remains unchanged.
  useEffect(() => {
    const prevTargetSessionId = prevTargetSessionIdRef.current;
    prevTargetSessionIdRef.current = targetSessionId;

    if (!targetSessionId) {
      setTarget(current => current === 'direct' ? 'all' : current);
      return;
    }

    if (targetSessionId !== prevTargetSessionId) {
      setTarget('direct');
    }
  }, [targetSessionId]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sessionCount === 0) return;
    if (target === 'direct' && targetSessionId) {
      onSendToSession(targetSessionId, trimmed);
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

  const directLabel = targetLabel || 'Direct';

  return (
    <div className="broadcast-bar">
      <div className="broadcast-label-row">
        <div className="broadcast-target-toggle">
          <button
            className={`broadcast-target-btn ${target === 'direct' ? 'active' : ''}`}
            onClick={() => setTarget('direct')}
            disabled={!targetSessionId}
            title={targetSessionId ? `Send to ${targetLabel || 'target agent'}` : 'No direct target available'}
          >
            {directLabel}
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
          placeholder={sessionCount === 0 ? 'No active sessions...' : target === 'direct' ? `Message ${targetLabel || 'target'}...` : officeName ? `Message to ${officeName} team (${sessionCount} agents)...` : `Broadcast to all agents (${sessionCount})...`}
          disabled={sessionCount === 0}
          rows={1}
        />
        <button
          className="broadcast-send-btn"
          onClick={handleSend}
          disabled={!text.trim() || sessionCount === 0}
        >
          {target === 'direct' ? 'Send' : 'Send All'}
        </button>
      </div>
    </div>
  );
}
