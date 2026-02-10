import { useState, useEffect, useCallback } from 'react';
import type { AgentIdentity } from '../types';

export function useAgents() {
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [agentmailConfigured, setAgentmailConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAgents(data.agents);
      setAgentmailConfigured(data.agentmailConfigured);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const createAgent = useCallback(async (name: string, defaultCliType: string): Promise<AgentIdentity | null> => {
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, defaultCliType }),
      });
      if (!res.ok) return null;
      const agent: AgentIdentity = await res.json();
      setAgents(prev => [...prev, agent].sort((a, b) => a.name.localeCompare(b.name)));
      return agent;
    } catch (err) {
      console.error('Failed to create agent:', err);
      return null;
    }
  }, []);

  const deleteAgentById = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      if (!res.ok) return false;
      setAgents(prev => prev.filter(a => a.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { agents, agentmailConfigured, loading, createAgent, deleteAgent: deleteAgentById, refresh: fetchAgents };
}
