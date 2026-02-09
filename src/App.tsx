import React, { useState, useEffect } from 'react';
import { ApiKeySetup } from './components/ApiKeySetup';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { InputSection } from './components/InputSection';
import { ResultView } from './components/ResultView';
import { ProcessingState } from './components/ProcessingState';
import { MeetingHistory } from './components/MeetingHistory';
import { MeetingDetailView } from './components/MeetingDetailView';
import { analyzeMeeting, setApiKeyCache } from './services/geminiService';
import { createMeeting, saveMeetingResult, updateMeetingStatus, checkApiKeyStatus } from './services/api';
import { AnalysisState } from './types';

type View = 'dashboard' | 'new' | 'history' | 'detail' | 'settings';

function App() {
  const [apiKeyReady, setApiKeyReady] = useState<boolean | null>(null); // null = loading
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: 'idle' });
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    checkApiKeyStatus()
      .then(({ configured }) => setApiKeyReady(configured))
      .catch(() => setApiKeyReady(false));
  }, []);

  const handleApiKeyConfigured = (key: string) => {
    setApiKeyCache(key);
    setApiKeyReady(true);
  };

  const [processingStage, setProcessingStage] = useState('');

  const handleAnalyze = async (text: string, file: File | null, participantImgs: File[] = []) => {
    setAnalysisState({ status: 'processing' });
    setProcessingStage('Creating meeting record...');

    // Separate: manual participant photos (few, permanent) vs recording screenshots (many, transient)
    // Only upload the audio file + text to the server for DB record
    // Screenshots go directly to Gemini client-side (never to our server)
    const MAX_IMGS_FOR_SERVER = 20; // Only store up to 20 images in DB
    const serverImgs = participantImgs.slice(0, MAX_IMGS_FOR_SERVER);

    const formData = new FormData();
    if (text) formData.append('text', text);
    if (file) formData.append('file', file);
    serverImgs.forEach(img => formData.append('participantImgs', img));

    let meetingId: string | null = null;

    try {
      const { id } = await createMeeting(formData);
      meetingId = id;
      await updateMeetingStatus(id, 'processing');
      setAnalysisState({ status: 'processing', meetingId: id });

      // Run Gemini analysis with ALL images (including screenshots beyond server limit)
      const result = await analyzeMeeting(text, file, participantImgs, (stage, detail) => {
        setProcessingStage(detail ? `${stage}: ${detail}` : stage);
      });

      // Extract executive summary and metadata
      const execMatch = result.match(/# 1\. Executive Summary[\s\S]*?\n([\s\S]*?)(?=\n# 2)/);
      const execSummary = execMatch ? execMatch[1].trim() : '';

      const metaMatch = result.match(/```json\s*([\s\S]*?)```/);
      const metaJson = metaMatch ? metaMatch[1].trim() : '{}';

      // Save result to DB
      await saveMeetingResult(id, {
        raw_markdown: result,
        executive_summary: execSummary,
        metadata_json: metaJson,
      });

      setAnalysisState({ status: 'success', result, meetingId: id });
    } catch (error: any) {
      const errMsg = error.message || 'Something went wrong during processing.';
      if (meetingId) {
        await updateMeetingStatus(meetingId, 'error', errMsg).catch(() => {});
      }
      
      if (error.message === 'API_KEY_NOT_CONFIGURED') {
        setApiKeyReady(false);
        return;
      }
      
      setAnalysisState({ status: 'error', error: errMsg, meetingId });
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

  // Loading state
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

  // API Key setup
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
            <p className="text-red-600 mb-6">{analysisState.error}</p>
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
