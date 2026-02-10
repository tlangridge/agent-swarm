import { useState, useEffect, useRef, useCallback } from 'react';
import { Mosaic, MosaicWindow, createBalancedTreeFromLeaves } from 'react-mosaic-component';
import type { MosaicNode, MosaicBranch } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import Header from './components/Header';
import AgentPicker from './components/AgentPicker';
import SettingsDialog from './components/SettingsDialog';
import TerminalWindow from './components/TerminalWindow';
import BroadcastBar from './components/BroadcastBar';
import { useAgents } from './hooks/useAgents';
import type { TerminalSession, CliType, ExecutionMode, PermissionMode, SwarmRole, SwarmMember, AgentIdentity, ServerMessage } from './types';

export default function App() {
  const [sessions, setSessions] = useState<Map<string, TerminalSession>>(new Map());
  const [layout, setLayout] = useState<MosaicNode<string> | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [swarmMembers, setSwarmMembers] = useState<SwarmMember[]>([]);
  const [leadSessionId, setLeadSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const writersRef = useRef<Map<string, (data: string) => void>>(new Map());
  const pendingCreatesRef = useRef<Map<string, { agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType; executionMode: ExecutionMode; swarmRole: SwarmRole }>>(new Map());

  const { agents, agentmailConfigured, dockerAvailable, dockerImageBuilt, createAgent, refresh } = useAgents();

  // WebSocket connection
  useEffect(() => {
    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000);
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
            };
            setSessions(prev => {
              const next = new Map(prev);
              next.set(msg.sessionId, session);
              return next;
            });
            setLayout(prev => {
              const leaves = prev ? getLeaves(prev) : [];
              leaves.push(msg.sessionId);
              return leaves.length === 1 ? leaves[0] : createBalancedTreeFromLeaves(leaves);
            });
            break;
          }

          case 'output': {
            const writer = writersRef.current.get(msg.sessionId);
            if (writer) writer(msg.data);
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
            setLayout(prev => {
              const leaves = prev ? getLeaves(prev) : [];
              leaves.push(msg.sessionId);
              return leaves.length === 1 ? leaves[0] : createBalancedTreeFromLeaves(leaves);
            });
            break;
          }
        }
      };
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  const sendWs = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  const handleAddTerminal = useCallback((agent: AgentIdentity | null, cliType: CliType, executionMode: ExecutionMode = 'local', permissionMode: PermissionMode = 'autonomous', swarmRole: SwarmRole = 'worker') => {
    setShowPicker(false);

    const tempId = crypto.randomUUID();

    pendingCreatesRef.current.set(tempId, {
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      agentEmail: agent?.email ?? null,
      cliType,
      executionMode,
      swarmRole,
    });

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
      cols: 80,
      rows: 24,
    });
  }, [sendWs]);

  const handleCloseTerminal = useCallback((sessionId: string) => {
    sendWs({ type: 'kill', sessionId });
    writersRef.current.delete(sessionId);
    setSessions(prev => {
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    setLayout(prev => {
      if (!prev) return null;
      const leaves = getLeaves(prev).filter(id => id !== sessionId);
      if (leaves.length === 0) return null;
      if (leaves.length === 1) return leaves[0];
      return createBalancedTreeFromLeaves(leaves);
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
  }, []);

  const handleBroadcast = useCallback((text: string) => {
    for (const [sessionId] of sessions) {
      sendWs({ type: 'input', sessionId, data: text + '\r' });
    }
  }, [sessions, sendWs]);

  const handleSendToLead = useCallback((text: string) => {
    if (leadSessionId) {
      sendWs({ type: 'input', sessionId: leadSessionId, data: text + '\r' });
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

  const leadAgentName = leadSessionId ? sessions.get(leadSessionId)?.agentName ?? null : null;

  const getTitle = useCallback((id: string): string => {
    const session = sessions.get(id);
    if (!session) return id;
    const cli = session.cliType.charAt(0).toUpperCase() + session.cliType.slice(1);
    const modeTag = session.executionMode === 'docker' ? ' [Docker]' : '';
    if (session.agentName) return `${cli}${modeTag} — ${session.agentName}${session.agentEmail ? ` (${session.agentEmail})` : ''}`;
    return `${cli}${modeTag}`;
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

  return (
    <div className="app">
      <Header
        sessionCount={sessions.size}
        connected={connected}
        onAddTerminal={() => setShowPicker(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="workspace">
        {layout ? (
          <Mosaic<string>
            value={layout}
            onChange={setLayout}
            renderTile={renderTile}
            className="mosaic-dark-theme"
          />
        ) : (
          <div className="empty-state">
            <p>No active terminals</p>
            <button className="primary-btn" onClick={() => setShowPicker(true)}>
              + Add Agent
            </button>
          </div>
        )}
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
          onSelect={handleAddTerminal}
          onCreateAgent={createAgent}
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

// Extract leaf node IDs from mosaic tree
function getLeaves(node: MosaicNode<string>): string[] {
  if (typeof node === 'string') return [node];
  return [...getLeaves(node.first), ...getLeaves(node.second)];
}
