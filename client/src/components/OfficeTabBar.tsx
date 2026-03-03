import type { ShiftState } from '../types';

interface Props {
  activeShifts: Map<string, ShiftState>;
  focusedOfficeId: string | null;
  unreadByOffice: Map<string, number>;
  onFocusOffice: (officeId: string) => void;
  onBack: () => void;
}

export default function OfficeTabBar({ activeShifts, focusedOfficeId, unreadByOffice, onFocusOffice, onBack }: Props) {
  if (activeShifts.size === 0) return null;

  return (
    <div className="office-tab-bar">
      <button
        className="office-tab-back"
        onClick={onBack}
        title="Back to offices"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a.5.5 0 0 1 .5.5V6h5a.5.5 0 0 1 0 1h-5v4.5a.5.5 0 0 1-.854.354L2.146 6.354a.5.5 0 0 1 0-.708l5.5-5.5A.5.5 0 0 1 8 1z" transform="rotate(180 8 8)"/>
        </svg>
      </button>
      {Array.from(activeShifts.entries()).map(([officeId, shift]) => {
        const isFocused = officeId === focusedOfficeId;
        const unread = unreadByOffice.get(officeId) || 0;
        const activeCount = shift.slots.filter(s => s.status === 'active').length;
        const hasFailures = shift.slots.some(s => s.status === 'failed');
        const isReview = shift.status === 'review';

        const statusColor = isReview ? '#e0af68' : hasFailures ? '#f7768e' : '#9ece6a';

        return (
          <button
            key={officeId}
            className={`office-tab ${isFocused ? 'focused' : ''}`}
            onClick={() => onFocusOffice(officeId)}
          >
            <span
              className="office-tab-dot"
              style={{ backgroundColor: statusColor }}
            />
            <span className="office-tab-name">{shift.officeName}</span>
            <span className="office-tab-count">{activeCount}</span>
            {unread > 0 && (
              <span className="office-tab-badge">{unread}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
