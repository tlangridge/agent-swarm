import { useState, useEffect } from 'react';
import type { Office, OfficeSlot, PipelineStage, ShiftState, ShiftSlotState, FunctionalRole, AgentIdentity } from '../types';
import { FUNCTIONAL_ROLE_COLORS, FUNCTIONAL_ROLE_LABELS } from '../types';
import OfficeEditor from './OfficeEditor';

interface Props {
  offices: Office[];
  activeShifts: Map<string, ShiftState>;
  agents: AgentIdentity[];
  onBadgeIn: (officeId: string) => void;
  onBadgeOut: (officeId: string) => void;
  onCreateOffice: (name: string, slots: any[], pipeline?: any[], context?: { projectPath?: string; soul?: string; memory?: string; instructions?: string; cronJobs?: any[] }) => Promise<any>;
  onUpdateOffice: (id: string, updates: Partial<Pick<Office, 'name' | 'slots' | 'pipeline' | 'cronJobs' | 'projectPath' | 'soul' | 'memory' | 'instructions'>>) => Promise<void>;
  onDeleteOffice: (id: string) => void;
  onRefresh: () => void;
  onSelectOffice?: (officeId: string) => void;
}

function SlotStatusDot({ status }: { status: ShiftSlotState['status'] }) {
  const colors: Record<string, string> = {
    pending: '#565f89',
    booting: '#ff9e64',
    active: '#9ece6a',
    failed: '#f7768e',
    ended: '#565f89',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: colors[status] || '#565f89',
        marginRight: 6,
      }}
    />
  );
}

function RoleBadge({ role }: { role: FunctionalRole }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 3,
        backgroundColor: FUNCTIONAL_ROLE_COLORS[role] + '22',
        color: FUNCTIONAL_ROLE_COLORS[role],
        border: `1px solid ${FUNCTIONAL_ROLE_COLORS[role]}44`,
        marginLeft: 6,
      }}
    >
      {FUNCTIONAL_ROLE_LABELS[role]}
    </span>
  );
}

export default function OfficeDashboard({ offices, activeShifts, agents, onBadgeIn, onBadgeOut, onCreateOffice, onUpdateOffice, onDeleteOffice, onRefresh, onSelectOffice }: Props) {
  const [showEditor, setShowEditor] = useState(false);
  const [editingOffice, setEditingOffice] = useState<Office | null>(null);
  const [deletingOffice, setDeletingOffice] = useState<Office | null>(null);

  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="office-dashboard">
      <div className="office-dashboard-header">
        <h2>Office</h2>
        <button className="office-btn" onClick={() => setShowEditor(true)}>
          + New Office
        </button>
      </div>

      {activeShifts.size > 0 && (
        <div className="office-shifts-active">
          {Array.from(activeShifts.values())
            .filter(shift => shift.status !== 'ended')
            .map(shift => (
              <div key={shift.officeId} className="office-shift-active">
                <div className="office-shift-title">
                  <span className="office-shift-dot active" />
                  Shift Active — {shift.officeName}
                </div>
                <div className="office-shift-slots">
                  {shift.slots.map((slot, i) => (
                    <div key={i} className="office-shift-slot">
                      <SlotStatusDot status={slot.status} />
                      <span>{slot.name}</span>
                      <RoleBadge role={slot.functionalRole} />
                      {slot.error && <span className="office-shift-error">{slot.error}</span>}
                    </div>
                  ))}
                </div>
                <button
                  className="office-btn danger"
                  onClick={() => {
                    const activeCount = shift.slots.filter(s => s.status === 'active').length;
                    const msg = activeCount > 0
                      ? `End shift "${shift.officeName}" and kill ${activeCount} active agent${activeCount !== 1 ? 's' : ''}?`
                      : `End shift "${shift.officeName}"?`;
                    if (window.confirm(msg)) onBadgeOut(shift.officeId);
                  }}
                >
                  End Shift
                </button>
              </div>
            ))}
        </div>
      )}

      {offices.length === 0 && activeShifts.size === 0 && (
        <div className="office-empty">
          <p>No offices yet. Create one to get started.</p>
          <p style={{ color: '#565f89', fontSize: 13 }}>
            An office defines your team — agents with specialties that badge in together.
          </p>
        </div>
      )}

      {offices.length > 0 && (
        <div className="office-list">
          {offices.map(office => {
            const isActive = activeShifts.has(office.id) && activeShifts.get(office.id)!.status !== 'ended';
            return (
              <div key={office.id} className="office-card">
                <div className="office-card-header">
                  <span className="office-card-name">{office.name}</span>
                  <span className="office-card-count">{office.slots.length} agents</span>
                </div>
                {office.projectPath && (
                  <div className="office-card-project-path" style={{ fontSize: 12, color: '#7aa2f7', marginBottom: 6, fontFamily: 'monospace' }}>
                    {office.projectPath}
                  </div>
                )}
                <div className="office-card-slots-preview">
                  {office.slots.map((slot, i) => (
                    <span key={i} className="office-slot-chip" style={{ borderColor: FUNCTIONAL_ROLE_COLORS[slot.functionalRole] + '66' }}>
                      <span style={{ color: FUNCTIONAL_ROLE_COLORS[slot.functionalRole] }}>
                        {FUNCTIONAL_ROLE_LABELS[slot.functionalRole]}
                      </span>
                      <span className="office-slot-chip-name">{slot.name}</span>
                    </span>
                  ))}
                </div>
                {office.cronJobs && office.cronJobs.length > 0 && (
                  <div className="office-card-crons">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="#565f89" style={{ flexShrink: 0 }}>
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5A5.5 5.5 0 1 1 13.5 8 5.506 5.506 0 0 1 8 13.5zM8.5 4H7v5l4.33 2.5.75-1.25L8.5 8.25V4z"/>
                    </svg>
                    <span>{office.cronJobs.length} scheduled task{office.cronJobs.length !== 1 ? 's' : ''}</span>
                    <span className="office-card-cron-names">
                      {office.cronJobs.filter(j => j.enabled).map(j => j.name).filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                {office.pipeline && office.pipeline.length > 0 && (
                  <div className="office-card-pipeline-info">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="#565f89" style={{ flexShrink: 0 }}>
                      <path d="M2 2h4v4H2V2zm8 0h4v4h-4V2zm-8 8h4v4H2v-4zm8 0h4v4h-4v-4z"/>
                    </svg>
                    <span>{office.pipeline.length}-stage pipeline</span>
                  </div>
                )}
                <div className="office-card-actions">
                  {onSelectOffice && (
                    <button
                      className="office-btn primary"
                      onClick={() => onSelectOffice(office.id)}
                    >
                      Enter
                    </button>
                  )}
                  {!isActive && !onSelectOffice && (
                    <button
                      className="office-btn primary"
                      onClick={() => onBadgeIn(office.id)}
                    >
                      Start Shift
                    </button>
                  )}
                  {!isActive && (
                    <button
                      className="office-btn"
                      onClick={() => setEditingOffice(office)}
                    >
                      Edit
                    </button>
                  )}
                  {!isActive && (
                    <button
                      className="office-btn danger-text"
                      onClick={() => setDeletingOffice(office)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showEditor && (
        <OfficeEditor
          agents={agents}
          onSave={async (name, slots, pipeline, context) => {
            await onCreateOffice(name, slots, pipeline, context);
            setShowEditor(false);
          }}
          onClose={() => setShowEditor(false)}
        />
      )}

      {editingOffice && (
        <OfficeEditor
          agents={agents}
          initialOffice={editingOffice}
          onSave={async (name, slots, pipeline, context) => {
            await onUpdateOffice(editingOffice.id, { name, slots, pipeline, ...context });
            setEditingOffice(null);
          }}
          onClose={() => setEditingOffice(null)}
        />
      )}

      {deletingOffice && (
        <div className="modal-overlay" onClick={() => setDeletingOffice(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Delete Office</h3>
              <button className="modal-close" onClick={() => setDeletingOffice(null)}>&times;</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p style={{ margin: 0 }}>
                Are you sure you want to delete <strong>{deletingOffice.name}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="office-btn" onClick={() => setDeletingOffice(null)}>Cancel</button>
              <button
                className="office-btn danger"
                onClick={() => {
                  onDeleteOffice(deletingOffice.id);
                  setDeletingOffice(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
