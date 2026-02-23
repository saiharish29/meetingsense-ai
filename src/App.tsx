import React, { useState, useEffect } from 'react';
import { ApiKeySetup } from './components/ApiKeySetup';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { InputSection } from './components/InputSection';
import { ResultView } from './components/ResultView';
import { ProcessingState } from './components/ProcessingState';
import { MeetingHistory } from './components/MeetingHistory';
import { MeetingDetailView } from './components/MeetingDetailView';
import { setSelectedModel } from './services/geminiService';
import { createMeeting, analyzeWithServer, checkApiKeyStatus, getModelPreference, updateMeetingStatus, getMeeting } from './services/api';
import { AnalysisState } from './types';

type View = 'dashboard' | 'new' | 'history' | 'detail' | 'settings';

// Maximum number of screenshots + participant images to store on the server.
// The server-side analyzer caps at 40 for Gemini, so uploading 40 ensures
// the best speaker-identification quality without wasting bandwidth.
const MAX_IMGS_FOR_SERVER = 40;

/** Evenly sample `count` items from an array (mirrors server-side logic) */
function sampleEvenly<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr;
  const step = arr.length / count;
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(arr[Math.floor(i * step)]);
  }
  return result;
}

function App() {
  const [apiKeyReady,     setApiKeyReady]     = useState<boolean | null>(null); // null = loading
  const [currentView,     setCurrentView]     = useState<View>('dashboard');
  const [analysisState,   setAnalysisState]   = useState<AnalysisState>({ status: 'idle' });
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [sidebarOpen,     setSidebarOpen]     = useState(true);
  const [processingStage, setProcessingStage] = useState('');

  // On mount: check API key and restore saved model preference
  useEffect(() => {
    checkApiKeyStatus()
      .then(({ configured, model }) => {
        if (configured && model) setSelectedModel(model);
        setApiKeyReady(configured);
      })
      .catch(() => setApiKeyReady(false));
  }, []);

  const handleApiKeyConfigured = (_key: string, model: string) => {
    setSelectedModel(model);
    setApiKeyReady(true);
  };

  /**
   * Main analysis flow:
   *  1. Upload audio + up-to-40 screenshots to the server (createMeeting)
   *  2. Ask server to run Gemini analysis via SSE-streamed endpoint
   *  3. The server handles File API upload, retry, fallback — not the browser
   *  4. Display the streamed result
   */
  const handleAnalyze = async (text: string, file: File | null, participantImgs: File[] = []) => {
    setAnalysisState({ status: 'processing' });
    setProcessingStage('Uploading recording...');

    // Evenly sample screenshots so we keep the most representative frames.
    // Participant photos (typically < 5) are always included by slicing at the end.
    const serverImgs = sampleEvenly(participantImgs, MAX_IMGS_FOR_SERVER);

    const formData = new FormData();
    if (text) formData.append('text', text);
    if (file) formData.append('file', file);
    serverImgs.forEach(img => formData.append('participantImgs', img));

    let meetingId: string | null = null;

    try {
      // 1. Store recording + metadata on server
      const { id } = await createMeeting(formData);
      meetingId = id;
      setAnalysisState({ status: 'processing', meetingId: id });

      // 2. Trigger server-side Gemini analysis (streams SSE progress)
      setProcessingStage('Starting Gemini analysis...');
      const result = await analyzeWithServer(
        id,
        null, // model — server uses DB-saved preference
        (stage, detail) => {
          setProcessingStage(detail ? `${stage}: ${detail}` : stage);
        },
      );

      // 3. Result is already persisted by the server — just show it
      setAnalysisState({ status: 'success', result, meetingId: id });
    } catch (error: any) {
      const errMsg = error.name === 'AbortError'
        ? 'Analysis timed out after 25 minutes. The recording may be too large or Gemini is temporarily unavailable. Please try again.'
        : (error.message || 'Something went wrong during processing.');

      // ── SSE stream recovery ───────────────────────────────────────────────
      // The SSE stream can end without delivering the `done` event if the
      // connection is reset mid-stream (network blip, dev-proxy idle timeout,
      // brief tab-switch, etc.).  When this happens the server has ALREADY
      // saved the result — `updateMeetingStatus('error')` would blindly
      // overwrite a perfectly valid 'completed' DB record.
      //
      // Strategy:
      //  • Check the current DB status BEFORE touching it.
      //  • 'completed' + result  → show the result (silent recovery, no error)
      //  • 'processing'          → server is still running; don't mark error
      //                            (it will complete on its own — user can check
      //                            Meeting History in a moment)
      //  • anything else         → mark error as before (keeps stuck meetings unblocked)
      if (meetingId) {
        try {
          const meeting = await getMeeting(meetingId);

          if (meeting.status === 'completed' && meeting.result?.raw_markdown) {
            // Server completed OK — SSE just lost the final event.  Recover silently.
            setAnalysisState({ status: 'success', result: meeting.result.raw_markdown, meetingId });
            return;
          }

          if (meeting.status === 'processing') {
            // Server is still working.  Don't stomp on it — it will finish.
            // Show a friendly "check history" message instead of a hard error.
            setAnalysisState({
              status: 'error',
              error: 'The connection to the analysis stream was interrupted. The analysis is still running on the server — please check Meeting History in a moment to see the completed result.',
              meetingId,
            });
            return;
          }

          // 'pending' or 'error' — safe to mark as errored to unblock it
          updateMeetingStatus(meetingId, 'error', errMsg).catch(() => {});
        } catch (_) {
          // Can't reach the server — best-effort mark as error
          updateMeetingStatus(meetingId, 'error', errMsg).catch(() => {});
        }
      }

      setAnalysisState({ status: 'error', error: errMsg, meetingId: meetingId ?? undefined });
    }
  };

  const handleReset = () => {
    setAnalysisState({ status: 'idle' });
    setCurrentView('dashboard');
  };

  const handleViewMeeting = (id: string) => {
    setSelectedMeetingId(id);
    setCurrentView('detail');
  };

  // ── Loading spinner ────────────────────────────────────────────────────────
  if (apiKeyReady === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 font-medium">Initializing MeetingSense AI...</p>
        </div>
      </div>
    );
  }

  // ── First-run API key + model setup ───────────────────────────────────────
  if (!apiKeyReady) {
    return <ApiKeySetup onConfigured={handleApiKeyConfigured} />;
  }

  return (
    <Layout
      currentView={currentView}
      onNavigate={(v) => { setCurrentView(v as View); setAnalysisState({ status: 'idle' }); }}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      onOpenSettings={() => { setApiKeyReady(false); }}
    >
      {currentView === 'dashboard' && (
        <Dashboard
          onNewMeeting={() => setCurrentView('new')}
          onViewMeeting={handleViewMeeting}
        />
      )}

      {currentView === 'new' && analysisState.status === 'idle' && (
        <InputSection onAnalyze={handleAnalyze} isProcessing={false} />
      )}

      {currentView === 'new' && analysisState.status === 'processing' && (
        <ProcessingState stage={processingStage} />
      )}

      {currentView === 'new' && analysisState.status === 'success' && analysisState.result && (
        <ResultView
          content={analysisState.result}
          meetingId={analysisState.meetingId}
          onReset={handleReset}
        />
      )}

      {currentView === 'new' && analysisState.status === 'error' && (
        <div className="flex flex-col items-center justify-center h-full p-8">
          <div className="bg-red-50 border border-red-100 rounded-2xl p-8 max-w-lg text-center shadow-lg">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-red-700 font-bold text-xl mb-2">Processing Error</h3>
            {/* whitespace-pre-line renders \n line-breaks from server error messages */}
            <p className="text-red-600 mb-6 text-sm leading-relaxed text-left whitespace-pre-line">
              {analysisState.error}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setAnalysisState({ status: 'idle' })}
                className="px-5 py-2.5 bg-white border border-red-200 text-red-700 font-semibold rounded-xl hover:bg-red-50 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'history' && (
        <MeetingHistory onViewMeeting={handleViewMeeting} />
      )}

      {currentView === 'detail' && selectedMeetingId && (
        <MeetingDetailView
          meetingId={selectedMeetingId}
          onBack={() => setCurrentView('history')}
        />
      )}
    </Layout>
  );
}

export default App;
