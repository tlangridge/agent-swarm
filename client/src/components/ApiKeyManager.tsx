import { useState, useEffect, useCallback } from 'react';
import type { ApiKeyEntry } from '../types';

const KNOWN_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'AGENTMAIL_API_KEY',
];

interface ApiKeyManagerProps {
  scope: 'global' | 'office';
  officeId?: string;
}

export default function ApiKeyManager({ scope, officeId }: ApiKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      setError(null);
      if (scope === 'global') {
        const res = await fetch('/api/keys/global');
        if (!res.ok) throw new Error('Failed to fetch keys');
        const data = await res.json();
        const entries: ApiKeyEntry[] = Object.entries(data.keys || {}).map(
          ([name, maskedValue]) => ({ name, maskedValue: maskedValue as string, source: 'global' as const })
        );
        setKeys(entries);
      } else if (scope === 'office' && officeId) {
        const res = await fetch(`/api/keys/resolved/${officeId}`);
        if (!res.ok) throw new Error('Failed to fetch keys');
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch keys');
    } finally {
      setLoading(false);
    }
  }, [scope, officeId]);

  useEffect(() => {
    setLoading(true);
    fetchKeys();
  }, [fetchKeys]);

  const handleSave = async (name: string, value: string) => {
    setSaving(true);
    setError(null);
    try {
      const url = scope === 'global'
        ? '/api/keys/global'
        : `/api/keys/offices/${officeId}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [name]: value }),
      });
      if (!res.ok) throw new Error('Failed to save key');
      setEditingKey(null);
      setEditValue('');
      setNewKeyName('');
      setNewKeyValue('');
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    setError(null);
    try {
      const url = scope === 'global'
        ? `/api/keys/global/${name}`
        : `/api/keys/offices/${officeId}/${name}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete key');
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key');
    }
  };

  const startEdit = (name: string) => {
    setEditingKey(name);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  // Keys that are directly set at this scope (editable)
  const isOwnKey = (entry: ApiKeyEntry) => {
    if (scope === 'global') return true;
    return entry.source === 'office';
  };

  // Filter out key names that are already set at this scope
  const usedKeyNames = keys.filter(k => isOwnKey(k)).map(k => k.name);
  const availableKeyNames = KNOWN_KEYS.filter(k => !usedKeyNames.includes(k));

  if (loading) {
    return (
      <div className="api-key-manager">
        <div className="api-key-empty">Loading keys...</div>
      </div>
    );
  }

  return (
    <div className="api-key-manager">
      {scope === 'office' && (
        <div className="api-key-manager-header">
          <div className="api-key-manager-title">API Keys</div>
          <div className="api-key-manager-subtitle">
            Override global defaults for this office. Inherited keys shown dimmed.
          </div>
        </div>
      )}

      {error && <div className="api-key-error">{error}</div>}

      <div className="api-key-table">
        {keys.length === 0 && (
          <div className="api-key-empty">No API keys configured.</div>
        )}
        {keys.map(entry => {
          const inherited = !isOwnKey(entry);
          const isEditing = editingKey === entry.name;

          return (
            <div
              key={entry.name}
              className={`api-key-row ${inherited ? 'inherited' : ''}`}
            >
              <span className="api-key-name">{entry.name}</span>

              {isEditing ? (
                <>
                  <input
                    className="api-key-input"
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    placeholder="Enter new value..."
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter' && editValue.trim()) handleSave(entry.name, editValue.trim());
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <button
                    className="api-key-save-btn"
                    disabled={!editValue.trim() || saving}
                    onClick={() => handleSave(entry.name, editValue.trim())}
                  >
                    Save
                  </button>
                  <button className="api-key-cancel-btn" onClick={cancelEdit}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="api-key-value">{entry.maskedValue}</span>

                  {scope === 'office' && (
                    <span className={`api-key-source ${entry.source}`}>
                      {entry.source}
                    </span>
                  )}

                  <div className="api-key-actions">
                    {!inherited && (
                      <>
                        <button
                          title="Edit key"
                          onClick={() => startEdit(entry.name)}
                        >
                          &#9998;
                        </button>
                        <button
                          className="delete"
                          title="Delete key"
                          onClick={() => handleDelete(entry.name)}
                        >
                          &#10005;
                        </button>
                      </>
                    )}
                    {inherited && scope === 'office' && (
                      <button
                        title="Override for this office"
                        onClick={() => startEdit(entry.name)}
                      >
                        &#9998;
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Add new key row */}
      {availableKeyNames.length > 0 && (
        <div className="api-key-add-row">
          <select
            className="api-key-select"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
          >
            <option value="">Add a key...</option>
            {availableKeyNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {newKeyName && (
            <>
              <input
                className="api-key-input"
                type="text"
                value={newKeyValue}
                onChange={e => setNewKeyValue(e.target.value)}
                placeholder="Paste API key value..."
                onKeyDown={e => {
                  if (e.key === 'Enter' && newKeyValue.trim()) handleSave(newKeyName, newKeyValue.trim());
                }}
              />
              <button
                className="api-key-save-btn"
                disabled={!newKeyValue.trim() || saving}
                onClick={() => handleSave(newKeyName, newKeyValue.trim())}
              >
                Save
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
