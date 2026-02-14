import { useState, useEffect, useRef, useCallback } from 'react';
import { Mosaic, MosaicWindow, createBalancedTreeFromLeaves } from 'react-mosaic-component';
import type { MosaicNode, MosaicBranch } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import Header from './components/Header';
import AgentPicker from './components/AgentPicker';
import SettingsDialog from './components/SettingsDialog';
import TerminalWindow from './components/TerminalWindow';
import BroadcastBar from './components/BroadcastBar';
import WorktreeActivityPanel from './components/WorktreeActivityPanel';
import { useAgents } from './hooks/useAgents';
import { useWorktrees } from './hooks/useWorktrees';
import { useWorktreeOverview } from './hooks/useWorktreeOverview';
import type { TerminalSession, CliType, ExecutionMode, PermissionMode, SwarmRole, SwarmMember, AgentIdentity, Worktree, ServerMessage } from './types';

export default function App() {
  const [sessions, setSessions] = useState<Map<string, TerminalSession>>(new Map());
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [swarmMembers, setSwarmMembers] = useState<SwarmMember[]>([]);
  const [leadSessionId, setLeadSessionId] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [projectPathValid, setProjectPathValid] = useState<boolean | null>(null);
  const [pickingProjectPath, setPickingProjectPath] = useState(false);
  const [layout, setLayout] = useState<MosaicNode<string> | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(360);

  const wsRef = useRef<WebSocket | null>(null);
  const writersRef = useRef<Map<string, (data: string) => void>>(new Map());
  const pendingCreatesRef = useRef<Map<string, { agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType; executionMode: ExecutionMode; swarmRole: SwarmRole; worktreeBranch?: string }>>(new Map());
  const pendingOutputRef = useRef<Map<string, string[]>>(new Map());

  const { agents, agentmailConfigured, dockerAvailable, dockerImageBuilt, createAgent, refresh } = useAgents();
  const { worktrees, isGitRepo, createWorktree, refresh: refreshWorktrees } = useWorktrees();
  const { overview, loading: overviewLoading, error: overviewError, refreshNow: refreshOverview } = useWorktreeOverview(connected);

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
        const msg: ServerMessage = JSON.parse(event.data);

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
            break;
          }

          case 'exited': {
            const writer = writersRef.current.get(msg.sessionId);
            if (writer) writer(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
            break;
          }

          case 'error': {
            console.error('Server error:', msg.message);
            break;
          }

          case 'swarm:update': {
            setSwarmMembers(msg.members);
            setLeadSessionId(msg.leadSessionId);
            // Sync swarmRole in sessions
            setSessions(prev => {
              const next = new Map(prev);
              for (const member of msg.members) {
                const session = next.get(member.sessionId);
                if (session && session.swarmRole !== member.role) {
                  next.set(member.sessionId, { ...session, swarmRole: member.role });
                }
              }
              return next;
            });
            break;
          }

          case 'session:spawned': {
            // Server-spawned agent (via POST /api/swarm/spawn) — add tile
            const session: TerminalSession = {
              id: msg.sessionId,
              agentId: msg.agentId,
              agentName: msg.agentName,
              agentEmail: msg.agentEmail,
              cliType: msg.cliType,
              executionMode: msg.executionMode,
              swarmRole: msg.swarmRole,
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

  const handleCloseTerminal = useCallback((sessionId: string) => {
    sendWs({ type: 'kill', sessionId });
    writersRef.current.delete(sessionId);
    setSessions(prev => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
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
    const sessionIds = Array.from(sessions.keys());
    setLayout(prev => reconcilePinnedLeadLayout(prev, sessionIds, leadSessionId));
  }, [sessions, leadSessionId]);

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
    return (
      <MosaicWindow<string>
        path={path}
        title={getTitle(id)}
        toolbarControls={
          <>
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
  }, [sessions, getTitle, handleCloseTerminal, handleInput, handleResize, handleTerminalReady, handleSetRole]);

  const handleOpenPicker = useCallback(() => {
    // Refresh worktrees when opening the picker
    if (projectPath) refreshWorktrees();
    setShowPicker(true);
  }, [projectPath, refreshWorktrees]);

  const handleLayoutChange = useCallback((next: MosaicNode<string> | null) => {
    const sessionIds = Array.from(sessions.keys());
    setLayout(reconcilePinnedLeadLayout(next, sessionIds, leadSessionId));
  }, [sessions, leadSessionId]);

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
        onAddTerminal={handleOpenPicker}
        onOpenSettings={() => setShowSettings(true)}
        onSetProjectPath={handleSetProjectPath}
        onPickProjectPath={handlePickProjectPath}
      />

      <div className="workspace">
        <div className="workspace-main">
          {layout ? (
            <Mosaic<string>
              value={layout}
              onChange={handleLayoutChange}
              renderTile={renderTile}
              className="mosaic-dark-theme"
            />
          ) : (
            <div className="empty-state">
              <p>No active terminals</p>
              <button className="primary-btn" onClick={handleOpenPicker}>
                + Add Agent
              </button>
            </div>
          )}
        </div>

        <div
          className="workspace-sidebar-resizer"
          onMouseDown={handleSidebarResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize worktree panel"
          tabIndex={-1}
        />

        <div className="workspace-sidebar" style={{ width: `min(${sidebarWidth}px, 100%)` }}>
          <WorktreeActivityPanel
            projectPath={projectPath}
            overview={overview}
            loading={overviewLoading}
            error={overviewError}
            onRefresh={refreshOverview}
          />
        </div>
      </div>

      <BroadcastBar
        sessionCount={sessions.size}
        leadSessionId={leadSessionId}
        leadAgentName={leadAgentName}
        onBroadcast={handleBroadcast}
        onSendToLead={handleSendToLead}
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
