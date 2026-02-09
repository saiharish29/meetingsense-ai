import React, { useState } from 'react';
import { saveApiKey, validateApiKey } from '../services/api';

interface ApiKeySetupProps {
  onConfigured: (key: string) => void;
}

export function ApiKeySetup({ onConfigured }: ApiKeySetupProps) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'validating' | 'success'>('input');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('Please enter your API key');
      return;
    }

    setLoading(true);
    setError('');
    setStep('validating');

    try {
      // Validate first
      const validation = await validateApiKey(apiKey.trim());
      if (!validation.valid) {
        setError(validation.error || 'Invalid API key. Please check and try again.');
        setStep('input');
        setLoading(false);
        return;
      }

      // Save to DB
      await saveApiKey(apiKey.trim());
      setStep('success');
      
      setTimeout(() => onConfigured(apiKey.trim()), 800);
    } catch (err: any) {
      setError(err.message || 'Failed to save API key');
      setStep('input');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-4 shadow-lg shadow-brand-200">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">MeetingSense AI</h1>
          <p className="text-slate-500 mt-1">Configure your Gemini API key to get started</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          {step === 'success' ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-green-700">API Key Configured!</h3>
              <p className="text-slate-500 text-sm mt-1">Launching MeetingSense AI...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Google Gemini API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setError(''); }}
                placeholder="Enter your API key..."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                autoFocus
                disabled={loading}
              />
              
              {error && (
                <p className="text-red-500 text-sm mt-2 flex items-center gap-1.5">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !apiKey.trim()}
                className="w-full mt-4 px-4 py-3 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Validating...
                  </>
                ) : (
                  'Continue →'
                )}
              </button>

              <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100">
                <p className="text-xs text-blue-700 leading-relaxed">
                  <span className="font-semibold">How to get an API key:</span> Visit{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline font-medium">
                    Google AI Studio
                  </a>
                  {' '}→ Click "Create API Key" → Copy and paste it above. Your key is stored locally in the database and never shared.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
