import type { ShiftState, ShiftSlotState } from '../types';
import { FUNCTIONAL_ROLE_COLORS, FUNCTIONAL_ROLE_LABELS } from '../types';

interface Props {
  shift: ShiftState;
  onBadgeOut: (officeId: string) => void;
}

export default function ShiftStatusBar({ shift, onBadgeOut }: Props) {
  return (
    <div className="shift-status-bar">
      <div className="shift-status-info">
        <span className="shift-status-label">
          {shift.status === 'starting' ? 'Booting team...' :
           shift.status === 'review' ? 'Ready for Review' : shift.officeName}
        </span>
        {shift.status === 'review' && shift.reviewSummary && (
          <span className="shift-review-summary" style={{ fontSize: 12, color: '#9ece6a', marginLeft: 8 }}>
            {shift.reviewSummary}
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
                {slot.retryCount != null && slot.retryCount > 0 && (
                  <span style={{ fontSize: 10, color: '#ff9e64', marginLeft: 4 }}>
                    (retry {slot.retryCount}/3)
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
      <button className="office-btn danger shift-end-btn" onClick={() => {
        const activeCount = shift.slots.filter(s => s.status === 'active').length;
        const msg = activeCount > 0
          ? `End shift "${shift.officeName}" and kill ${activeCount} active agent${activeCount !== 1 ? 's' : ''}?`
          : `End shift "${shift.officeName}"?`;
        if (window.confirm(msg)) onBadgeOut(shift.officeId);
      }}>
        {shift.status === 'review' ? 'Approve & End Shift' : 'End Shift'}
      </button>
    </div>
  );
}
