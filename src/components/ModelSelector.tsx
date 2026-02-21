import React, { useState, useEffect } from 'react';
import { fetchAvailableModels, saveModelPreference } from '../services/api';

interface Model {
  id: string;
  displayName: string;
  description: string;
  isRecommended: boolean;
  inputTokenLimit: number | null;
}

interface ModelSelectorProps {
  /** API key to use for fetching models. If omitted, uses the server's saved key. */
  apiKeyOverride?: string;
  /** Currently selected model ID */
  currentModel?: string;
  /** Called when the user saves their model choice */
  onModelSaved: (model: string) => void;
  /** Called when the user cancels / closes the panel */
  onCancel?: () => void;
  /** If true, renders as a standalone setup step (no cancel button) */
  setupMode?: boolean;
}

export function ModelSelector({
  apiKeyOverride,
  currentModel,
  onModelSaved,
  onCancel,
  setupMode = false,
}: ModelSelectorProps) {
  const [models,   setModels]   = useState<Model[]>([]);
  const [selected, setSelected] = useState<string>(currentModel || '');
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchAvailableModels(apiKeyOverride)
      .then(({ models: list, currentModel: saved }) => {
        if (cancelled) return;
        setModels(list);
        // Pre-select: prop > server saved > first recommended > first in list
        const initial = currentModel || saved || list.find(m => m.isRecommended)?.id || list[0]?.id || '';
        setSelected(initial);
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Failed to load models');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [apiKeyOverride, currentModel]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await saveModelPreference(selected);
      onModelSaved(selected);
    } catch (err: any) {
      setError(err.message || 'Failed to save model preference');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-3 text-slate-500">
        <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading available models...</span>
      </div>
    );
  }

  if (error && models.length === 0) {
    return (
      <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
        <strong>Could not load models:</strong> {error}
        <button
          onClick={() => window.location.reload()}
          className="ml-3 underline font-medium hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const recommended = models.filter(m => m.isRecommended);
  const others      = models.filter(m => !m.isRecommended);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Gemini Model
        </label>
        <p className="text-xs text-slate-500 mb-3">
          All recommended models support multi-modal audio analysis. Larger models produce richer
          summaries but may be slower.
        </p>

        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm"
        >
          {recommended.length > 0 && (
            <optgroup label="Recommended for audio analysis">
              {recommended.map(m => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.inputTokenLimit ? ` (${(m.inputTokenLimit / 1_000_000).toFixed(0)}M ctx)` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Other models">
              {others.map(m => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Show selected model details */}
      {selected && (() => {
        const m = models.find(x => x.id === selected);
        if (!m) return null;
        return (
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 leading-relaxed">
            <strong>{m.displayName}</strong>
            {m.description && <> — {m.description.slice(0, 160)}{m.description.length > 160 ? '…' : ''}</>}
            {m.inputTokenLimit && (
              <span className="ml-1 font-medium">
                · {(m.inputTokenLimit / 1_000).toFixed(0)}K token context
              </span>
            )}
            {m.isRecommended && (
              <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-semibold">
                ✓ Recommended
              </span>
            )}
          </div>
        );
      })()}

      {error && (
        <p className="text-red-500 text-sm flex items-center gap-1.5">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </p>
      )}

      <div className="flex gap-3">
        {!setupMode && onCancel && (
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors text-sm"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !selected}
          className="flex-1 px-4 py-2.5 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 text-sm"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : setupMode ? (
            'Confirm Model →'
          ) : (
            'Save'
          )}
        </button>
      </div>
    </div>
  );
}
