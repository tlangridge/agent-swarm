import { useState, useEffect } from 'react';
import type { ShiftState, ShiftSlotState } from '../types';
import { FUNCTIONAL_ROLE_COLORS, FUNCTIONAL_ROLE_LABELS } from '../types';

interface Props {
  shift: ShiftState;
  totalShiftCost?: number;
  compactionCountsBySession: Map<string, number>;
  onBadgeOut: (officeId: string) => void;
  onCloseShift: (officeId: string) => void;
}

export default function ShiftStatusBar({ shift, totalShiftCost, compactionCountsBySession, onBadgeOut, onCloseShift }: Props) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);

  useEffect(() => {
    if (shift.status !== 'closing' || !shift.closingStartedAt) return;

    const calculate = () => {
      const elapsed = (Date.now() - new Date(shift.closingStartedAt!).getTime()) / 1000;
      return Math.max(0, Math.ceil(60 - elapsed));
    };

    setSecondsRemaining(calculate());

    const interval = setInterval(() => {
      setSecondsRemaining(calculate());
    }, 1000);

    return () => clearInterval(interval);
  }, [shift.status, shift.closingStartedAt]);

  const isClosing = shift.status === 'closing';

  return (
    <div className="shift-status-bar">
      <div className="shift-status-info">
        <span className="shift-status-label">
          {isClosing
            ? (shift.shiftNumber ? `Closing shift #${shift.shiftNumber}...` : 'Closing shift...')
            : shift.status === 'starting' ? 'Booting team...'
            : shift.status === 'review' ? 'Ready for Review'
            : shift.officeName}
        </span>
        {shift.status === 'review' && shift.reviewSummary && (
          <span className="shift-review-summary" style={{ fontSize: 12, color: '#9ece6a', marginLeft: 8 }}>
            {shift.reviewSummary}
          </span>
        )}
        {isClosing && (
          <span className="shift-closing-info">
            <span className="shift-closing-countdown">{secondsRemaining}s</span> remaining
          </span>
        )}
        <div className="shift-status-badges">
          {shift.slots.map((slot: ShiftSlotState, i: number) => {
            const colors: Record<string, string> = {
              pending: '#565f89',
              booting: '#ff9e64',
              active: '#9ece6a',
              failed: '#f7768e',
              ended: '#565f89',
            };
            const color = colors[slot.status] || '#565f89';
            return (
              <span
                key={i}
                className="shift-agent-badge"
                title={`${slot.name} (${FUNCTIONAL_ROLE_LABELS[slot.functionalRole]}) — ${slot.status}`}
                style={{ borderColor: color }}
              >
                <span
                  className="shift-agent-dot"
                  style={{ backgroundColor: color }}
                />
                <span style={{ color: FUNCTIONAL_ROLE_COLORS[slot.functionalRole] }}>
                  {slot.name}
                </span>
                <span
                  className="shift-agent-compaction"
                  title={`Compactions: ${slot.sessionId ? (compactionCountsBySession.get(slot.sessionId) ?? 0) : 0}`}
                >
                  C{slot.sessionId ? (compactionCountsBySession.get(slot.sessionId) ?? 0) : 0}
                </span>
                {slot.retryCount != null && slot.retryCount > 0 && (
                  <span style={{ fontSize: 10, color: '#ff9e64', marginLeft: 4 }}>
                    (retry {slot.retryCount}/3)
                  </span>
                )}
              </span>
            );
          })}
        </div>
        {totalShiftCost != null && totalShiftCost > 0 && (
          <span className="shift-cost-badge">${totalShiftCost.toFixed(2)}</span>
        )}
      </div>
      {isClosing ? (
        <button className="office-btn danger shift-end-btn" onClick={() => {
          if (window.confirm(`Force end shift "${shift.officeName}" immediately?`)) onBadgeOut(shift.officeId);
        }}>
          Force End
        </button>
      ) : (
        <>
          {(shift.status === 'starting' || shift.status === 'active' || shift.status === 'review') && (
            <button className="office-btn primary shift-close-btn" onClick={() => {
              if (window.confirm(`Close shift "${shift.officeName}"? Agents will have 60 seconds to write close-out notes.`)) onCloseShift(shift.officeId);
            }}>
              Close Shift
            </button>
          )}
          <button className="office-btn danger shift-end-btn" onClick={() => {
            const activeCount = shift.slots.filter(s => s.status === 'active').length;
            const msg = activeCount > 0
              ? `End shift "${shift.officeName}" and kill ${activeCount} active agent${activeCount !== 1 ? 's' : ''}?`
              : `End shift "${shift.officeName}"?`;
            if (window.confirm(msg)) onBadgeOut(shift.officeId);
          }}>
            {shift.status === 'review' ? 'Approve & End Shift' : 'End Shift'}
          </button>
        </>
      )}
    </div>
  );
}
