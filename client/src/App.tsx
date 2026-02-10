import { useState, useEffect, useRef, useCallback } from 'react';
import { Mosaic, MosaicWindow, createBalancedTreeFromLeaves } from 'react-mosaic-component';
import type { MosaicNode, MosaicBranch } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import Header from './components/Header';
import AgentPicker from './components/AgentPicker';
import TerminalWindow from './components/TerminalWindow';
import BroadcastBar from './components/BroadcastBar';
import { useAgents } from './hooks/useAgents';
import type { TerminalSession, CliType, AgentIdentity, ServerMessage } from './types';

export default function App() {
  const [sessions, setSessions] = useState<Map<string, TerminalSession>>(new Map());
  const [layout, setLayout] = useState<MosaicNode<string> | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const writersRef = useRef<Map<string, (data: string) => void>>(new Map());
  const pendingCreatesRef = useRef<Map<string, { agentId: string | null; agentName: string | null; agentEmail: string | null; cliType: CliType }>>(new Map());

  const { agents, agentmailConfigured, createAgent } = useAgents();

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
            const pending = pendingCreatesRef.current.get(msg.sessionId);
            if (pending) {
              pendingCreatesRef.current.delete(msg.sessionId);
            }
            const session: TerminalSession = {
              id: msg.sessionId,
              agentId: pending?.agentId ?? msg.agentId,
              agentName: pending?.agentName ?? null,
              agentEmail: pending?.agentEmail ?? null,
              cliType: msg.cliType,
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

  const handleAddTerminal = useCallback((agent: AgentIdentity | null, cliType: CliType) => {
    setShowPicker(false);

    // We generate a temporary ID to track the create request
    // The server will assign the real sessionId and send it back in 'created'
    const tempId = crypto.randomUUID();

    pendingCreatesRef.current.set(tempId, {
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      agentEmail: agent?.email ?? null,
      cliType,
    });

    sendWs({
      type: 'create',
      agentId: agent?.id,
      agentName: agent?.name,
      agentEmail: agent?.email,
      cliType,
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

  const getTitle = useCallback((id: string): string => {
    const session = sessions.get(id);
    if (!session) return id;
    const cli = session.cliType.charAt(0).toUpperCase() + session.cliType.slice(1);
    if (session.agentName) return `${cli} — ${session.agentName}${session.agentEmail ? ` (${session.agentEmail})` : ''}`;
    return cli;
  }, [sessions]);

  const renderTile = useCallback((id: string, path: MosaicBranch[]) => {
    return (
      <MosaicWindow<string>
        path={path}
        title={getTitle(id)}
        toolbarControls={
          <button
            className="mosaic-close-btn"
            onClick={() => handleCloseTerminal(id)}
            title="Close terminal"
          >
            &times;
          </button>
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
  }, [getTitle, handleCloseTerminal, handleInput, handleResize, handleTerminalReady]);

  return (
    <div className="app">
      <Header
        sessionCount={sessions.size}
        connected={connected}
        onAddTerminal={() => setShowPicker(true)}
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

      <BroadcastBar sessionCount={sessions.size} onBroadcast={handleBroadcast} />

      {showPicker && (
        <AgentPicker
          agents={agents}
          agentmailConfigured={agentmailConfigured}
          onSelect={handleAddTerminal}
          onCreateAgent={createAgent}
          onClose={() => setShowPicker(false)}
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
