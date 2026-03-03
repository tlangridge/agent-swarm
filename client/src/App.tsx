import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Mosaic, MosaicWindow, createBalancedTreeFromLeaves } from 'react-mosaic-component';
import type { MosaicNode, MosaicBranch } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import Header from './components/Header';
import AgentPicker from './components/AgentPicker';
import SettingsDialog from './components/SettingsDialog';
import TerminalWindow from './components/TerminalWindow';
import BroadcastBar from './components/BroadcastBar';
import WorktreeActivityPanel from './components/WorktreeActivityPanel';
import OfficeDashboard from './components/OfficeDashboard';
import AgentDashboard from './components/AgentDashboard';
import AgentManager from './components/AgentManager';
import SessionPicker from './components/SessionPicker';
import ShiftStatusBar from './components/ShiftStatusBar';
import OfficeTabBar from './components/OfficeTabBar';
import PipelinePanel from './components/PipelinePanel';
import WorkflowPanel from './components/WorkflowPanel';
import { useAgents } from './hooks/useAgents';
import { useWorktrees } from './hooks/useWorktrees';
import { useWorktreeOverview } from './hooks/useWorktreeOverview';
import { useOffices } from './hooks/useOffices';
import { useTasks } from './hooks/useTasks';
import { useHashRoute } from './hooks/useHashRoute';
import { useNotifications } from './hooks/useNotifications';
import type { TerminalSession, CliType, ExecutionMode, PermissionMode, SwarmRole, SwarmMember, AgentIdentity, Worktree, ServerMessage, FunctionalRole, ShiftState, SavedSessionSummary } from './types';
import { FUNCTIONAL_ROLE_COLORS, FUNCTIONAL_ROLE_LABELS } from './types';

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

export default function App() {
  const [sessions, setSessions] = useState<Map<string, TerminalSession>>(new Map());
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [swarmMembers, setSwarmMembers] = useState<SwarmMember[]>([]);
  const [projectPath, setProjectPath] = useState('');
  const [projectPathValid, setProjectPathValid] = useState<boolean | null>(null);
  const [pickingProjectPath, setPickingProjectPath] = useState(false);
  const [layouts, setLayouts] = useState<Map<string, MosaicNode<string> | null>>(new Map());
  const [focusedOfficeId, setFocusedOfficeId] = useState<string | null>(null);
  const focusedOfficeIdRef = useRef<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(360);

  const wsRef = useRef<WebSocket | null>(null);
  const writersRef = useRef<Map<string, (data: string) => void>>(new Map());
  const pendingCreatesRef = useRef<Map<string, { agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType; executionMode: ExecutionMode; swarmRole: SwarmRole; functionalRole: FunctionalRole | null; worktreeBranch?: string }>>(new Map());
  const pendingOutputRef = useRef<Map<string, string[]>>(new Map());

  const [sidebarTab, setSidebarTab] = useState<'worktrees' | 'pipeline' | 'workflow'>('worktrees');
  const [view, setView] = useState<'workspace' | 'agents'>('workspace');
  const [workspaceMode, setWorkspaceMode] = useState<'dashboard' | 'grid'>('dashboard');
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);

  // Output preview buffers — refs updated on every WS output, state synced every 500ms
  const outputPreviewsRef = useRef<Map<string, string[]>>(new Map());
  const lastActivityRef = useRef<Map<string, number>>(new Map());
  const [outputPreviews, setOutputPreviews] = useState<Map<string, string[]>>(new Map());
  const [lastActivityAt, setLastActivityAt] = useState<Map<string, number>>(new Map());

  const { agents, agentmailConfigured, dockerAvailable, dockerImageBuilt, createAgent, updateAgent, deleteAgent, refresh } = useAgents();
  const { worktrees, isGitRepo, createWorktree, refresh: refreshWorktrees } = useWorktrees();
  const { overview, loading: overviewLoading, error: overviewError, refreshNow: refreshOverview } = useWorktreeOverview(connected);
  const { offices, activeShifts, setActiveShifts, fetchOffices, createOffice, updateOffice, deleteOffice, badgeIn, badgeOut } = useOffices();
  const { officeId: routeOfficeId, setOfficeId: setRouteOfficeId } = useHashRoute();
  const { notifications, addNotification, markAllReadForOffice, unreadByOffice } = useNotifications();
  const { tasks, moveTask } = useTasks(connected, focusedOfficeId || selectedOfficeId || undefined);
  const selectedOffice = offices.find(o => o.id === selectedOfficeId) || null;

  // Derive the current office's shift from the shifts map
  const activeShift = focusedOfficeId ? activeShifts.get(focusedOfficeId) ?? null : null;

  // Filter sessions for the focused office
  // When no office is focused (browsing all offices), show empty so OfficeDashboard renders
  const sessionsForOffice = useMemo(() => {
    if (!focusedOfficeId) {
      // Show only ad-hoc sessions (no officeId) when browsing offices
      const adHoc = new Map<string, TerminalSession>();
      for (const [id, session] of sessions) {
        if (!session.officeId) adHoc.set(id, session);
      }
      return adHoc;
    }
    const filtered = new Map<string, TerminalSession>();
    for (const [id, session] of sessions) {
      if (session.officeId === focusedOfficeId || !session.officeId) {
        filtered.set(id, session);
      }
    }
    return filtered;
  }, [sessions, focusedOfficeId]);

  // Get layout for focused office
  const layout = focusedOfficeId ? layouts.get(focusedOfficeId) ?? null : null;

  // Get lead for focused office
  const leadSessionId = useMemo(() => {
    const member = swarmMembers.find(m =>
      m.officeId === focusedOfficeId && m.role === 'lead'
    );
    return member?.sessionId ?? null;
  }, [swarmMembers, focusedOfficeId]);

  // setLayout wrapper — store per-office
  const setLayoutForOffice = useCallback((newLayout: MosaicNode<string> | null) => {
    if (!focusedOfficeId) return;
    setLayouts(prev => {
      const next = new Map(prev);
      next.set(focusedOfficeId, newLayout);
      return next;
    });
  }, [focusedOfficeId]);

  const handleBadgeIn = useCallback(async (officeId: string) => {
    setFocusedOfficeId(officeId);
    setSelectedOfficeId(officeId);
    setRouteOfficeId(officeId);
    await badgeIn(officeId);
  }, [badgeIn, setRouteOfficeId]);

  const handleBadgeOut = useCallback(async (officeId: string) => {
    await badgeOut(officeId);
    // Clean up only this office's sessions
    setSessions(prev => {
      const next = new Map(prev);
      for (const [id, session] of prev) {
        if (session.officeId === officeId) {
          next.delete(id);
          writersRef.current.delete(id);
          outputPreviewsRef.current.delete(id);
          lastActivityRef.current.delete(id);
        }
      }
      return next;
    });
    // Clean up layout
    setLayouts(prev => {
      const next = new Map(prev);
      next.delete(officeId);
      return next;
    });
    // If we were focused on this office, unfocus
    if (focusedOfficeId === officeId) {
      // Focus next active office or clear
      const remaining = [...activeShifts.keys()].filter(id => id !== officeId);
      setFocusedOfficeId(remaining[0] || null);
    }
  }, [badgeOut, focusedOfficeId, activeShifts]);

  // Keep ref in sync for use inside WS handler closure
  useEffect(() => {
    focusedOfficeIdRef.current = focusedOfficeId;
  }, [focusedOfficeId]);

  // Sync from URL hash on mount
  useEffect(() => {
    if (routeOfficeId && !focusedOfficeId) {
      setFocusedOfficeId(routeOfficeId);
    }
  }, [routeOfficeId]);

  // Auto-focus first active shift only when shifts change (not on manual unfocus)
  useEffect(() => {
    if (!focusedOfficeIdRef.current && activeShifts.size > 0) {
      const firstShift = activeShifts.values().next().value;
      if (firstShift) {
        setFocusedOfficeId(firstShift.officeId);
      }
    }
  }, [activeShifts]);

  // Mark notifications read when focusing an office
  useEffect(() => {
    if (focusedOfficeId) {
      markAllReadForOffice(focusedOfficeId);
    }
  }, [focusedOfficeId, markAllReadForOffice]);

  // Session picker state
  const [savedSessions, setSavedSessions] = useState<SavedSessionSummary[] | null>(null);
  const [savedSessionsMeta, setSavedSessionsMeta] = useState<{ savedAt: string; projectPath: string } | null>(null);
  const [sessionPickerDismissed, setSessionPickerDismissed] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Fetch saved sessions on mount to decide whether to show the picker
  useEffect(() => {
    fetch('/api/sessions/saved')
      .then(res => res.json())
      .then(data => {
        if (data.hasSavedSessions && data.sessions.length > 0) {
          setSavedSessions(data.sessions);
          setSavedSessionsMeta({ savedAt: data.savedAt, projectPath: data.projectPath });
        } else {
          setSessionPickerDismissed(true);
        }
      })
      .catch(() => {
        setSessionPickerDismissed(true);
      });
  }, []);

  const handleRestoreSessions = useCallback(async (sessionIds: string[]) => {
    setRestoring(true);
    try {
      await fetch('/api/sessions/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds }),
      });
      setSessionPickerDismissed(true);
      // Force WS reconnect to pick up restored sessions
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(); // triggers onclose -> reconnect timer -> new connection -> session:restore messages
      }
    } catch (err) {
      console.error('Failed to restore sessions:', err);
    } finally {
      setRestoring(false);
    }
  }, []);

  const handleStartFresh = useCallback(async () => {
    try {
      await fetch('/api/sessions/discard', { method: 'POST' });
    } catch {
      // ignore
    }
    setSessionPickerDismissed(true);
  }, []);

  // Fetch initial project path
  useEffect(() => {
    fetch('/api/project')
      .then(res => res.json())
      .then(data => {
        if (data.projectPath) {
          setProjectPath(data.projectPath);
          setProjectPathValid(true);
        }
      })
      .catch(() => {});
  }, []);

  // Refresh worktrees when project path changes
  useEffect(() => {
    if (projectPath) {
      refreshWorktrees();
    }
  }, [projectPath, refreshWorktrees]);

  useEffect(() => {
    if (projectPath) {
      refreshOverview();
    }
  }, [projectPath, refreshOverview]);

  // WebSocket connection
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        const msg: ServerMessage = parsed;

        switch (msg.type) {
          case 'created': {
            const requestId = msg.requestId;
            const pending = requestId ? pendingCreatesRef.current.get(requestId) : undefined;
            if (pending && requestId) {
              pendingCreatesRef.current.delete(requestId);
            }
            const session: TerminalSession = {
              id: msg.sessionId,
              agentId: pending?.agentId ?? msg.agentId,
              agentName: pending?.agentName ?? null,
              agentEmail: pending?.agentEmail ?? null,
              cliType: msg.cliType,
              executionMode: pending?.executionMode ?? 'local',
              swarmRole: pending?.swarmRole ?? 'worker',
              functionalRole: pending?.functionalRole ?? null,
              worktreeBranch: pending?.worktreeBranch,
            };
            setSessions(prev => {
              const next = new Map(prev);
              next.set(msg.sessionId, session);
              return next;
            });
            break;
          }

          case 'output': {
            const writer = writersRef.current.get(msg.sessionId);
            if (writer) {
              writer(msg.data);
            } else {
              // Buffer for sessions whose terminal hasn't mounted yet
              const pending = pendingOutputRef.current.get(msg.sessionId) || [];
              pending.push(msg.data);
              pendingOutputRef.current.set(msg.sessionId, pending);
            }

            // Update output preview buffer (ref only — synced to state every 500ms)
            {
              const existing = outputPreviewsRef.current.get(msg.sessionId) || [];
              const stripped = stripAnsi(msg.data).replace(/\r/g, '');
              const newLines = stripped.split('\n').filter(l => l.trim());
              const combined = [...existing, ...newLines].slice(-8);
              outputPreviewsRef.current.set(msg.sessionId, combined);
              lastActivityRef.current.set(msg.sessionId, Date.now());
            }
            break;
          }

          case 'exited': {
            const writer = writersRef.current.get(msg.sessionId);
            if (writer) writer(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
            outputPreviewsRef.current.delete(msg.sessionId);
            lastActivityRef.current.delete(msg.sessionId);
            setFocusedSessionId(prev => prev === msg.sessionId ? null : prev);
            break;
          }

          case 'error': {
            console.error('Server error:', msg.message);
            break;
          }

          case 'swarm:update': {
            // If officeId is present, only update members for that office
            if (msg.officeId) {
              const oid = msg.officeId;
              setSwarmMembers(prev => {
                const others = prev.filter(m => m.officeId !== oid);
                const newMembers = (msg.members || []).map(m => ({ ...m, officeId: oid }));
                return [...others, ...newMembers];
              });
            } else {
              setSwarmMembers(msg.members || []);
            }
            // Sync swarmRole and functionalRole in sessions
            setSessions(prev => {
              const next = new Map(prev);
              for (const member of (msg.members || [])) {
                const session = next.get(member.sessionId);
                if (session && (session.swarmRole !== member.role || session.functionalRole !== member.functionalRole)) {
                  next.set(member.sessionId, { ...session, swarmRole: member.role, functionalRole: member.functionalRole });
                }
              }
              return next;
            });
            break;
          }

          case 'session:spawned': {
            // Server-spawned agent (via POST /api/swarm/spawn or badge-in) — add tile
            const session: TerminalSession = {
              id: msg.sessionId,
              agentId: msg.agentId,
              agentName: msg.agentName,
              agentEmail: msg.agentEmail,
              cliType: msg.cliType,
              executionMode: msg.executionMode,
              swarmRole: msg.swarmRole,
              functionalRole: msg.functionalRole,
              worktreeBranch: msg.worktreeBranch || undefined,
              officeId: msg.officeId || focusedOfficeIdRef.current || undefined,
            };
            setSessions(prev => {
              const next = new Map(prev);
              next.set(msg.sessionId, session);
              return next;
            });
            break;
          }

          case 'session:restore': {
            const session: TerminalSession = {
              id: msg.sessionId,
              agentId: msg.agentId,
              agentName: msg.agentName,
              agentEmail: msg.agentEmail,
              cliType: msg.cliType,
              executionMode: msg.executionMode,
              swarmRole: msg.swarmRole,
              functionalRole: msg.functionalRole,
              worktreeBranch: msg.worktreeBranch || undefined,
              officeId: msg.officeId || undefined,
            };
            setSessions(prev => {
              const next = new Map(prev);
              next.set(msg.sessionId, session);
              return next;
            });
            // Only replay scrollback if terminal hasn't mounted yet (fresh page load).
            // On WS reconnect without reload, writer already exists — skip to avoid duplication.
            if (msg.scrollback && !writersRef.current.has(msg.sessionId)) {
              const pending = pendingOutputRef.current.get(msg.sessionId) || [];
              pending.push(msg.scrollback);
              pendingOutputRef.current.set(msg.sessionId, pending);
            }
            // Seed output preview from scrollback
            if (msg.scrollback) {
              const stripped = stripAnsi(msg.scrollback).replace(/\r/g, '');
              const lines = stripped.split('\n').filter(l => l.trim()).slice(-8);
              outputPreviewsRef.current.set(msg.sessionId, lines);
              lastActivityRef.current.set(msg.sessionId, Date.now());
            }
            break;
          }

          case 'shift:progress': {
            setActiveShifts(prev => {
              const next = new Map(prev);
              const shift = next.get(msg.officeId);
              if (shift) {
                const updated = { ...shift, slots: [...shift.slots] };
                if (updated.slots[msg.slotIndex]) {
                  updated.slots[msg.slotIndex] = {
                    ...updated.slots[msg.slotIndex],
                    status: msg.status,
                    sessionId: msg.sessionId || updated.slots[msg.slotIndex].sessionId,
                    error: msg.error,
                  };
                }
                next.set(msg.officeId, updated);
              }
              return next;
            });
            break;
          }

          case 'shift:status': {
            const shift = msg.shift;
            if (shift) {
              setActiveShifts(prev => {
                const next = new Map(prev);
                if (shift.status === 'ended') {
                  next.delete(shift.officeId);
                } else {
                  next.set(shift.officeId, shift);
                }
                return next;
              });
            }
            break;
          }

          case 'office:notification': {
            if (msg.notification) {
              addNotification(msg.notification);
            }
            break;
          }
        }
      };
    }

    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null; // prevent reconnect from firing on cleanup close
        ws.close();
      }
    };
  }, []);

  const sendWs = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  // Subscribe to focused office + all active offices (for notifications)
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const officeIds = [...activeShifts.keys()];
    if (focusedOfficeId && !officeIds.includes(focusedOfficeId)) {
      officeIds.push(focusedOfficeId);
    }

    ws.send(JSON.stringify({ type: 'subscribe', officeIds }));
  }, [focusedOfficeId, activeShifts]);

  const handleSetProjectPath = useCallback(async (path: string) => {
    try {
      const res = await fetch('/api/project', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: path }),
      });
      const data = await res.json();
      if (res.ok) {
        setProjectPath(data.projectPath);
        setProjectPathValid(true);
        sendWs({ type: 'set-project-path', projectPath: data.projectPath });
      } else {
        // Still update locally so user sees what they typed
        setProjectPath(path);
        setProjectPathValid(false);
      }
    } catch {
      setProjectPath(path);
      setProjectPathValid(false);
    }
  }, [sendWs]);

  const handlePickProjectPath = useCallback(async () => {
    setPickingProjectPath(true);
    try {
      const res = await fetch('/api/project/pick', {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        console.error('Failed to pick project path:', data?.error || 'Unknown error');
        return;
      }
      if (data.cancelled) return;
      if (typeof data.projectPath === 'string') {
        setProjectPath(data.projectPath);
        setProjectPathValid(true);
        sendWs({ type: 'set-project-path', projectPath: data.projectPath });
      }
    } catch (err) {
      console.error('Failed to pick project path:', err);
    } finally {
      setPickingProjectPath(false);
    }
  }, [sendWs]);

  const handleAddTerminal = useCallback((agent: AgentIdentity | null, cliType: CliType, executionMode: ExecutionMode = 'local', permissionMode: PermissionMode = 'autonomous', swarmRole: SwarmRole = 'worker', worktree: Worktree | null = null) => {
    setShowPicker(false);

    const tempId = crypto.randomUUID();

    pendingCreatesRef.current.set(tempId, {
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      agentEmail: agent?.email ?? null,
      cliType,
      executionMode,
      swarmRole,
      functionalRole: null,
      worktreeBranch: worktree?.branch,
    });

    // If a worktree is selected, send its path as the projectPath override
    const effectivePath = worktree?.path || projectPath || undefined;

    sendWs({
      type: 'create',
      requestId: tempId,
      agentId: agent?.id,
      agentName: agent?.name,
      agentEmail: agent?.email,
      cliType,
      executionMode,
      permissionMode,
      swarmRole,
      projectPath: effectivePath,
      cols: 80,
      rows: 24,
    });
  }, [sendWs, projectPath]);

  const handleRestartTerminal = useCallback((sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Kill old session
    sendWs({ type: 'kill', sessionId });
    writersRef.current.delete(sessionId);
    setSessions(prev => { const next = new Map(prev); next.delete(sessionId); return next; });

    // Re-create with same config
    const tempId = crypto.randomUUID();
    pendingCreatesRef.current.set(tempId, {
      agentId: session.agentId, agentName: session.agentName, agentEmail: session.agentEmail,
      cliType: session.cliType, executionMode: session.executionMode,
      swarmRole: session.swarmRole, functionalRole: session.functionalRole,
      worktreeBranch: session.worktreeBranch,
    });
    sendWs({
      type: 'create', requestId: tempId,
      agentId: session.agentId ?? undefined, agentName: session.agentName ?? undefined,
      agentEmail: session.agentEmail ?? undefined, cliType: session.cliType,
      executionMode: session.executionMode, permissionMode: 'autonomous',
      swarmRole: session.swarmRole, functionalRole: session.functionalRole,
      projectPath: projectPath || undefined, cols: 80, rows: 24,
    });
  }, [sessions, sendWs, projectPath]);

  const handleCloseTerminal = useCallback((sessionId: string) => {
    sendWs({ type: 'kill', sessionId });
    writersRef.current.delete(sessionId);
    outputPreviewsRef.current.delete(sessionId);
    lastActivityRef.current.delete(sessionId);
    setSessions(prev => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    setFocusedSessionId(prev => prev === sessionId ? null : prev);
  }, [sendWs]);

  const handleInput = useCallback((sessionId: string, data: string) => {
    sendWs({ type: 'input', sessionId, data });
  }, [sendWs]);

  const handleResize = useCallback((sessionId: string, cols: number, rows: number) => {
    sendWs({ type: 'resize', sessionId, cols, rows });
  }, [sendWs]);

  const handleTerminalReady = useCallback((sessionId: string, write: (data: string) => void) => {
    writersRef.current.set(sessionId, write);
    // Flush any buffered output (e.g. scrollback from restored sessions)
    const pending = pendingOutputRef.current.get(sessionId);
    if (pending) {
      for (const data of pending) write(data);
      pendingOutputRef.current.delete(sessionId);
    }
  }, []);

  const handleBroadcast = useCallback((text: string) => {
    for (const [sessionId] of sessions) {
      sendWs({ type: 'inject', sessionId, text });
    }
  }, [sessions, sendWs]);

  const handleSendToLead = useCallback((text: string) => {
    if (leadSessionId) {
      sendWs({ type: 'inject', sessionId: leadSessionId, text });
    }
  }, [leadSessionId, sendWs]);

  const handleSetRole = useCallback((sessionId: string, role: SwarmRole) => {
    sendWs({ type: 'set-role', sessionId, role });
  }, [sendWs]);

  const handleBuildDockerImage = useCallback(async () => {
    try {
      const res = await fetch('/api/docker/build', { method: 'POST' });
      await res.text();
      refresh();
    } catch (err) {
      console.error('Docker build failed:', err);
    }
  }, [refresh]);

  useEffect(() => {
    const sessionIds = Array.from(sessionsForOffice.keys());
    const newLayout = reconcilePinnedLeadLayout(layout, sessionIds, leadSessionId);
    setLayoutForOffice(newLayout);
  }, [sessionsForOffice, leadSessionId]);

  // Sync output preview refs → state every 500ms (avoids re-render on every WS chunk)
  useEffect(() => {
    const timer = setInterval(() => {
      setOutputPreviews(new Map(outputPreviewsRef.current));
      setLastActivityAt(new Map(lastActivityRef.current));
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Escape key exits focused terminal view
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedSessionId) {
        setFocusedSessionId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedSessionId]);

  const leadAgentName = leadSessionId ? sessions.get(leadSessionId)?.agentName ?? null : null;

  const getTitle = useCallback((id: string): string => {
    const session = sessions.get(id);
    if (!session) return id;
    const cli = session.cliType.charAt(0).toUpperCase() + session.cliType.slice(1);
    const modeTag = session.executionMode === 'docker' ? ' [Docker]' : '';
    const branchTag = session.worktreeBranch ? ` [${session.worktreeBranch}]` : '';
    if (session.agentName) return `${cli}${modeTag}${branchTag} — ${session.agentName}${session.agentEmail ? ` (${session.agentEmail})` : ''}`;
    return `${cli}${modeTag}${branchTag}`;
  }, [sessions]);

  const renderTile = useCallback((id: string, path: MosaicBranch[]) => {
    const session = sessions.get(id);
    const isLead = session?.swarmRole === 'lead';
    const fr = session?.functionalRole;
    return (
      <MosaicWindow<string>
        path={path}
        title={getTitle(id)}
        toolbarControls={
          <>
            {fr && (
              <span
                className="mosaic-role-badge"
                style={{
                  backgroundColor: FUNCTIONAL_ROLE_COLORS[fr] + '22',
                  color: FUNCTIONAL_ROLE_COLORS[fr],
                  border: `1px solid ${FUNCTIONAL_ROLE_COLORS[fr]}44`,
                }}
              >
                {FUNCTIONAL_ROLE_LABELS[fr]}
              </span>
            )}
            <button
              className={`mosaic-lead-btn ${isLead ? 'active' : ''}`}
              onClick={() => handleSetRole(id, isLead ? 'worker' : 'lead')}
              title={isLead ? 'Demote to worker' : 'Promote to lead'}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 13.5V15h12v-1.5H2zm.5-2.5h11l-1.5-5-3 2L8 4.5 6.5 8l-3-2L2 11.5z"/>
              </svg>
            </button>
            <button
              className="mosaic-restart-btn"
              onClick={() => handleRestartTerminal(id)}
              title="Restart terminal"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 0 0-7 7h2a5 5 0 0 1 9.17-2.74L10 7h5V2l-1.94 1.94A7 7 0 0 0 8 1zm5 7a5 5 0 0 1-9.17 2.74L6 9H1v5l1.94-1.94A7 7 0 0 0 15 8h-2z"/>
              </svg>
            </button>
            <button
              className="mosaic-close-btn"
              onClick={() => handleCloseTerminal(id)}
              title="Close terminal"
            >
              &times;
            </button>
          </>
        }
      >
        <TerminalWindow
          sessionId={id}
          onInput={handleInput}
          onResize={handleResize}
          onTerminalReady={handleTerminalReady}
        />
      </MosaicWindow>
    );
  }, [sessions, getTitle, handleCloseTerminal, handleRestartTerminal, handleInput, handleResize, handleTerminalReady, handleSetRole]);

  const handleOpenPicker = useCallback(() => {
    // Refresh worktrees when opening the picker
    if (projectPath) refreshWorktrees();
    setShowPicker(true);
  }, [projectPath, refreshWorktrees]);

  const handleToggleWorkspaceMode = useCallback(() => {
    setFocusedSessionId(null);
    setWorkspaceMode(prev => prev === 'dashboard' ? 'grid' : 'dashboard');
  }, []);

  const handleLayoutChange = useCallback((next: MosaicNode<string> | null) => {
    const sessionIds = Array.from(sessionsForOffice.keys());
    setLayoutForOffice(reconcilePinnedLeadLayout(next, sessionIds, leadSessionId));
  }, [sessionsForOffice, leadSessionId, setLayoutForOffice]);

  const handleSidebarResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const minWidth = 240;
    const maxWidth = Math.min(720, Math.floor(window.innerWidth * 0.65));

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  return (
    <div className="app">
      <Header
        sessionCount={sessions.size}
        connected={connected}
        projectPath={projectPath}
        projectPathValid={projectPathValid}
        pickingProjectPath={pickingProjectPath}
        workspaceMode={workspaceMode}
        onAddTerminal={handleOpenPicker}
        onOpenSettings={() => setShowSettings(true)}
        onManageAgents={() => setView(view === 'agents' ? 'workspace' : 'agents')}
        onSetProjectPath={handleSetProjectPath}
        onPickProjectPath={handlePickProjectPath}
        onToggleWorkspaceMode={handleToggleWorkspaceMode}
      />

      {activeShifts.size > 0 && (
        <OfficeTabBar
          activeShifts={activeShifts}
          focusedOfficeId={focusedOfficeId}
          unreadByOffice={unreadByOffice}
          onFocusOffice={(id) => {
            setFocusedOfficeId(id);
            setSelectedOfficeId(id);
            setRouteOfficeId(id);
            markAllReadForOffice(id);
          }}
          onBack={() => {
            setFocusedOfficeId(null);
            setSelectedOfficeId(null);
            setRouteOfficeId(null);
          }}
        />
      )}

      {activeShift && activeShift.status !== 'ended' && (
        <ShiftStatusBar
          shift={activeShift}
          onBadgeOut={handleBadgeOut}
        />
      )}

      {view === 'agents' ? (
        <AgentManager
          agents={agents}
          offices={offices}
          agentmailConfigured={agentmailConfigured}
          onCreateAgent={createAgent}
          onUpdateAgent={updateAgent}
          onDeleteAgent={deleteAgent}
          onUpdateOffice={updateOffice}
          onBack={() => setView('workspace')}
        />
      ) : (
        <div className="workspace">
          <div className="workspace-main">
            {savedSessions && !sessionPickerDismissed ? (
              <div className="empty-state">
                <SessionPicker
                  sessions={savedSessions}
                  savedAt={savedSessionsMeta!.savedAt}
                  projectPath={savedSessionsMeta!.projectPath}
                  onRestore={handleRestoreSessions}
                  onStartFresh={handleStartFresh}
                  loading={restoring}
                />
              </div>
            ) : sessionsForOffice.size === 0 ? (
              <div className="empty-state">
                {selectedOfficeId && selectedOffice ? (
                  <div className="office-detail-view">
                    <div className="office-detail-header">
                      <button className="office-back-btn" onClick={() => setSelectedOfficeId(null)}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <path fillRule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8z"/>
                        </svg>
                        Back to Offices
                      </button>
                      <h2>{selectedOffice.name}</h2>
                    </div>
                    {selectedOffice.projectPath && (
                      <div className="office-detail-project" style={{ fontSize: 12, color: '#7aa2f7', fontFamily: 'monospace', marginBottom: 12 }}>
                        {selectedOffice.projectPath}
                      </div>
                    )}
                    <div className="office-detail-slots">
                      {selectedOffice.slots.map((slot, i) => (
                        <span key={i} className="office-slot-chip" style={{ borderColor: FUNCTIONAL_ROLE_COLORS[slot.functionalRole] + '66' }}>
                          <span style={{ color: FUNCTIONAL_ROLE_COLORS[slot.functionalRole] }}>
                            {FUNCTIONAL_ROLE_LABELS[slot.functionalRole]}
                          </span>
                          <span className="office-slot-chip-name">{slot.name}</span>
                        </span>
                      ))}
                    </div>
                    {(!activeShifts.has(selectedOfficeId)) && (
                      <button className="office-btn primary" onClick={() => handleBadgeIn(selectedOfficeId)} style={{ marginTop: 16 }}>
                        Start Shift
                      </button>
                    )}
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #1a1b26' }}>
                      <button className="primary-btn" onClick={handleOpenPicker}>
                        + Add Agent Manually
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <OfficeDashboard
                      offices={offices}
                      activeShifts={activeShifts}
                      agents={agents}
                      onBadgeIn={handleBadgeIn}
                      onBadgeOut={handleBadgeOut}
                      onCreateOffice={createOffice}
                      onUpdateOffice={updateOffice}
                      onDeleteOffice={deleteOffice}
                      onRefresh={fetchOffices}
                      onSelectOffice={setSelectedOfficeId}
                    />
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #1a1b26' }}>
                      <button className="primary-btn" onClick={handleOpenPicker}>
                        + Add Agent Manually
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : focusedSessionId && sessions.has(focusedSessionId) ? (
              <div className="focused-split-view">
                <div className="focused-split-main">
                  <div className="focused-terminal-toolbar">
                    <button className="focused-back-btn" onClick={() => setFocusedSessionId(null)}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8z"/>
                      </svg>
                      Back
                    </button>
                    <span className="focused-terminal-title">{getTitle(focusedSessionId)}</span>
                    {(() => {
                      const fs = sessions.get(focusedSessionId);
                      const isLead = fs?.swarmRole === 'lead';
                      const fr = fs?.functionalRole;
                      return (
                        <>
                          {fr && (
                            <span
                              className="mosaic-role-badge"
                              style={{
                                backgroundColor: FUNCTIONAL_ROLE_COLORS[fr] + '22',
                                color: FUNCTIONAL_ROLE_COLORS[fr],
                                border: `1px solid ${FUNCTIONAL_ROLE_COLORS[fr]}44`,
                              }}
                            >
                              {FUNCTIONAL_ROLE_LABELS[fr]}
                            </span>
                          )}
                          <button
                            className={`mosaic-lead-btn ${isLead ? 'active' : ''}`}
                            onClick={() => handleSetRole(focusedSessionId, isLead ? 'worker' : 'lead')}
                            title={isLead ? 'Demote to worker' : 'Promote to lead'}
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M2 13.5V15h12v-1.5H2zm.5-2.5h11l-1.5-5-3 2L8 4.5 6.5 8l-3-2L2 11.5z"/>
                            </svg>
                          </button>
                          <button
                            className="mosaic-restart-btn"
                            onClick={() => handleRestartTerminal(focusedSessionId)}
                            title="Restart terminal"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 1a7 7 0 0 0-7 7h2a5 5 0 0 1 9.17-2.74L10 7h5V2l-1.94 1.94A7 7 0 0 0 8 1zm5 7a5 5 0 0 1-9.17 2.74L6 9H1v5l1.94-1.94A7 7 0 0 0 15 8h-2z"/>
                            </svg>
                          </button>
                          <button
                            className="mosaic-close-btn"
                            onClick={() => handleCloseTerminal(focusedSessionId)}
                            title="Close terminal"
                          >
                            &times;
                          </button>
                        </>
                      );
                    })()}
                  </div>
                  <TerminalWindow
                    sessionId={focusedSessionId}
                    onInput={handleInput}
                    onResize={handleResize}
                    onTerminalReady={handleTerminalReady}
                  />
                </div>
                <div className="focused-split-sidebar">
                  <div className="sidebar-header">Agents</div>
                  <div className="sidebar-agent-list">
                    {Array.from(sessionsForOffice.entries()).map(([sid, sess]) => {
                      const isFocused = sid === focusedSessionId;
                      const isLead = sid === leadSessionId;
                      const fr = sess.functionalRole;
                      const lastActive = lastActivityAt.get(sid) || 0;
                      const idleSec = lastActive ? Math.floor((Date.now() - lastActive) / 1000) : -1;
                      const idleLabel = idleSec < 0 ? '--' : idleSec < 30 ? 'Active' : idleSec < 60 ? `${idleSec}s` : idleSec < 3600 ? `${Math.floor(idleSec / 60)}m` : `${Math.floor(idleSec / 3600)}h`;
                      const preview = outputPreviews.get(sid) || [];
                      const agentTasks = sess.agentName ? tasks.filter(t => t.assignedTo === sess.agentName) : [];
                      const currentTask = agentTasks.find(t => t.status === 'in-progress') || agentTasks.find(t => t.status === 'open');

                      return (
                        <div
                          key={sid}
                          className={`sidebar-agent-row ${isFocused ? 'sidebar-agent-focused' : ''}`}
                          onClick={() => setFocusedSessionId(sid)}
                        >
                          <div className="sidebar-agent-top">
                            <span
                              className="sidebar-agent-dot"
                              style={{ backgroundColor: lastActive && Date.now() - lastActive < 30_000 ? '#9ece6a' : '#565f89' }}
                            />
                            <span className="sidebar-agent-name">{sess.agentName || sess.cliType}</span>
                            {isLead && (
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="#e0af68" style={{ flexShrink: 0 }}>
                                <path d="M2 13.5V15h12v-1.5H2zm.5-2.5h11l-1.5-5-3 2L8 4.5 6.5 8l-3-2L2 11.5z"/>
                              </svg>
                            )}
                            {fr && (
                              <span
                                className="sidebar-agent-badge"
                                style={{
                                  backgroundColor: FUNCTIONAL_ROLE_COLORS[fr] + '22',
                                  color: FUNCTIONAL_ROLE_COLORS[fr],
                                  border: `1px solid ${FUNCTIONAL_ROLE_COLORS[fr]}44`,
                                }}
                              >
                                {FUNCTIONAL_ROLE_LABELS[fr]}
                              </span>
                            )}
                            <span className="sidebar-agent-idle">{idleLabel}</span>
                          </div>
                          {currentTask && (
                            <div className="sidebar-agent-task">{currentTask.title}</div>
                          )}
                          <div className="sidebar-agent-preview">
                            {preview.length > 0 ? preview.slice(-3).join('\n') : 'Waiting...'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : workspaceMode === 'dashboard' ? (
              <AgentDashboard
                sessions={sessionsForOffice}
                swarmMembers={swarmMembers}
                leadSessionId={leadSessionId}
                activeShift={activeShift}
                tasks={tasks}
                outputPreviews={outputPreviews}
                lastActivityAt={lastActivityAt}
                onFocusSession={setFocusedSessionId}
                onSetRole={handleSetRole}
                onRestartSession={handleRestartTerminal}
                onCloseSession={handleCloseTerminal}
              />
            ) : layout ? (
              <Mosaic<string>
                value={layout}
                onChange={handleLayoutChange}
                renderTile={renderTile}
                className="mosaic-dark-theme"
              />
            ) : null}
          </div>

          {selectedOfficeId && (
            <>
              <div
                className="workspace-sidebar-resizer"
                onMouseDown={handleSidebarResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar panel"
                tabIndex={-1}
              />

              <div className="workspace-sidebar" style={{ width: `min(${sidebarWidth}px, 100%)` }}>
                <div className="sidebar-tabs">
                  <button
                    className={`sidebar-tab ${sidebarTab === 'worktrees' ? 'active' : ''}`}
                    onClick={() => setSidebarTab('worktrees')}
                  >
                    Worktrees
                  </button>
                  <button
                    className={`sidebar-tab ${sidebarTab === 'pipeline' ? 'active' : ''}`}
                    onClick={() => setSidebarTab('pipeline')}
                  >
                    Pipeline
                  </button>
                  <button
                    className={`sidebar-tab ${sidebarTab === 'workflow' ? 'active' : ''}`}
                    onClick={() => setSidebarTab('workflow')}
                  >
                    Workflow
                  </button>
                </div>
                <div className="sidebar-tab-content">
                  {sidebarTab === 'worktrees' ? (
                    <WorktreeActivityPanel
                      projectPath={projectPath}
                      overview={overview}
                      loading={overviewLoading}
                      error={overviewError}
                      onRefresh={refreshOverview}
                    />
                  ) : sidebarTab === 'pipeline' ? (
                    <PipelinePanel
                      tasks={tasks}
                      stages={selectedOffice?.pipeline || []}
                      onMoveTask={moveTask}
                    />
                  ) : (
                    <WorkflowPanel activeShift={activeShift} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <BroadcastBar
        sessionCount={sessionsForOffice.size}
        leadSessionId={leadSessionId}
        leadAgentName={leadAgentName}
        onBroadcast={handleBroadcast}
        onSendToLead={handleSendToLead}
        officeName={activeShift?.officeName}
      />

      {showPicker && (
        <AgentPicker
          agents={agents}
          agentmailConfigured={agentmailConfigured}
          dockerAvailable={dockerAvailable}
          dockerImageBuilt={dockerImageBuilt}
          leadSessionId={leadSessionId}
          worktrees={worktrees}
          isGitRepo={isGitRepo}
          projectPath={projectPath}
          onSelect={handleAddTerminal}
          onCreateAgent={createAgent}
          onCreateWorktree={createWorktree}
          onBuildDockerImage={handleBuildDockerImage}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showSettings && (
        <SettingsDialog
          dockerAvailable={dockerAvailable}
          dockerImageBuilt={dockerImageBuilt}
          onBuildDockerImage={handleBuildDockerImage}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function reconcilePinnedLeadLayout(
  prevLayout: MosaicNode<string> | null,
  sessionIds: string[],
  leadSessionId: string | null,
): MosaicNode<string> | null {
  if (sessionIds.length === 0) return null;

  if (!prevLayout) {
    return buildPinnedLeadLayout(sessionIds, leadSessionId, 42);
  }

  const sessionSet = new Set(sessionIds);
  if (!hasSameLeaves(prevLayout, sessionSet)) {
    const ordered = listLeaves(prevLayout).filter(id => sessionSet.has(id));
    for (const sessionId of sessionIds) {
      if (!ordered.includes(sessionId)) ordered.push(sessionId);
    }
    return buildPinnedLeadLayout(ordered, leadSessionId, getPinnedLeadSplit(prevLayout, leadSessionId));
  }

  if (leadSessionId && sessionIds.includes(leadSessionId) && !isPinnedLeadLayout(prevLayout, leadSessionId, sessionSet)) {
    return buildPinnedLeadLayout(listLeaves(prevLayout), leadSessionId, getPinnedLeadSplit(prevLayout, leadSessionId));
  }

  return prevLayout;
}

function buildPinnedLeadLayout(
  orderedSessionIds: string[],
  leadSessionId: string | null,
  splitPercentage: number,
): MosaicNode<string> | null {
  if (orderedSessionIds.length === 0) return null;

  if (!leadSessionId || !orderedSessionIds.includes(leadSessionId)) {
    return orderedSessionIds.length === 1 ? orderedSessionIds[0] : createBalancedTreeFromLeaves(orderedSessionIds);
  }

  const workerSessionIds = orderedSessionIds.filter(id => id !== leadSessionId);
  if (workerSessionIds.length === 0) return leadSessionId;

  const workerLayout = workerSessionIds.length === 1
    ? workerSessionIds[0]
    : createBalancedTreeFromLeaves(workerSessionIds);
  if (!workerLayout) return leadSessionId;

  return {
    direction: 'row',
    splitPercentage,
    first: leadSessionId,
    second: workerLayout,
  };
}

function hasSameLeaves(layout: MosaicNode<string>, expected: Set<string>): boolean {
  const leaves = listLeaves(layout);
  if (leaves.length !== expected.size) return false;
  return leaves.every(id => expected.has(id));
}

function isPinnedLeadLayout(
  layout: MosaicNode<string>,
  leadSessionId: string,
  expectedSessions: Set<string>,
): boolean {
  if (!isMosaicBranch(layout)) return false;
  if (layout.direction !== 'row') return false;
  if (layout.first !== leadSessionId) return false;
  if (!layout.second) return false;

  const secondLeaves = listLeaves(layout.second);
  if (secondLeaves.includes(leadSessionId)) return false;

  return hasSameLeaves(layout, expectedSessions);
}

function getPinnedLeadSplit(layout: MosaicNode<string> | null, leadSessionId: string | null): number {
  if (!layout || !leadSessionId || !isMosaicBranch(layout)) return 42;
  if (layout.direction === 'row' && layout.first === leadSessionId && typeof layout.splitPercentage === 'number') {
    return layout.splitPercentage;
  }
  return 42;
}

function isMosaicBranch(node: MosaicNode<string>): node is { direction: 'row' | 'column'; first: MosaicNode<string>; second: MosaicNode<string>; splitPercentage?: number } {
  return typeof node !== 'string';
}

function listLeaves(node: MosaicNode<string>): string[] {
  if (typeof node === 'string') return [node];
  return [...listLeaves(node.first), ...listLeaves(node.second)];
}
