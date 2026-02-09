import React, { useState, useEffect } from 'react';

interface ProcessingStateProps {
  stage?: string;
}

const FALLBACK_STEPS = [
  { label: 'Uploading files...', duration: 2000 },
  { label: 'Processing audio/text...', duration: 3000 },
  { label: 'Extracting key information...', duration: 4000 },
  { label: 'Generating structured summary...', duration: 5000 },
  { label: 'Finalizing analysis...', duration: 3000 },
];

export function ProcessingState({ stage }: ProcessingStateProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Animated fallback steps (when no real progress)
  useEffect(() => {
    if (!stage && currentStep < FALLBACK_STEPS.length - 1) {
      const timer = setTimeout(() => setCurrentStep(prev => prev + 1), FALLBACK_STEPS[currentStep].duration);
      return () => clearTimeout(timer);
    }
  }, [currentStep, stage]);

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 animate-fade-in">
      <div className="max-w-sm w-full text-center">
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 border-4 border-slate-100 rounded-full" />
          <div className="absolute inset-0 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <div className="absolute inset-3 bg-brand-50 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Analyzing Your Meeting</h2>
        <p className="text-sm text-slate-500 mb-1">This may take a few minutes for longer recordings</p>
        <p className="text-xs text-slate-400 mb-6">Elapsed: {formatElapsed(elapsed)}</p>

        {/* Real progress from Gemini service */}
        {stage ? (
          <div className="bg-brand-50 border border-brand-100 rounded-xl p-4">
            <div className="flex items-center gap-2.5 text-sm text-brand-700 font-medium">
              <div className="w-4 h-4 flex-shrink-0 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              {stage}
            </div>
          </div>
        ) : (
          /* Fallback animated steps */
          <div className="space-y-2 text-left">
            {FALLBACK_STEPS.map((step, i) => (
              <div key={i} className={`flex items-center gap-2.5 text-sm transition-all duration-300 ${
                i < currentStep ? 'text-green-600' : i === currentStep ? 'text-brand-600 font-medium' : 'text-slate-300'
              }`}>
                {i < currentStep ? (
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                ) : i === currentStep ? (
                  <div className="w-4 h-4 flex-shrink-0 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <div className="w-4 h-4 flex-shrink-0 rounded-full border-2 border-slate-200" />
                )}
                {step.label}
              </div>
            ))}
          </div>
        )}

        {elapsed > 30 && (
          <p className="text-xs text-slate-400 mt-4">
            💡 Longer meetings take more time to analyze. Gemini processes up to 9.5 hours of audio.
          </p>
        )}
      </div>
    </div>
  );
}
