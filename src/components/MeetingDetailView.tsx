import React, { useState, useEffect } from 'react';
import { getMeeting } from '../services/api';
import { MeetingDetail } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  meetingId: string;
  onBack: () => void;
}

export function MeetingDetailView({ meetingId, onBack }: Props) {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMeeting(meetingId).then(setMeeting).catch(console.error).finally(() => setLoading(false));
  }, [meetingId]);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!meeting) return <div className="p-8 text-center text-slate-500">Meeting not found</div>;

  const handleExport = () => {
    if (!meeting.result?.raw_markdown) return;
    const blob = new Blob([meeting.result.raw_markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meeting.title.replace(/[^a-z0-9]/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="font-bold text-slate-900">{meeting.title}</h1>
            <p className="text-xs text-slate-400">{new Date(meeting.created_at).toLocaleString()} {meeting.duration_minutes ? `• ${meeting.duration_minutes} min` : ''}</p>
          </div>
        </div>
        {meeting.result && (
          <button onClick={handleExport} className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700">
            Export Markdown
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {meeting.status === 'error' && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-4">
              <p className="text-red-700 font-medium text-sm">Error: {meeting.error_message}</p>
            </div>
          )}

          {meeting.status === 'processing' && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-4">
              <p className="text-amber-700 font-medium text-sm">This meeting is still being processed...</p>
            </div>
          )}

          {/* Input info */}
          {meeting.inputs.length > 0 && (
            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Inputs</h3>
              <div className="space-y-1">
                {meeting.inputs.map(inp => (
                  <div key={inp.id} className="text-xs text-slate-500 flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-200 rounded font-mono">{inp.input_type}</span>
                    {inp.file_name && <span>{inp.file_name} ({((inp.file_size || 0) / 1024 / 1024).toFixed(1)} MB)</span>}
                    {inp.text_content && <span>{inp.text_content.substring(0, 100)}...</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {meeting.result ? (
            <div className="markdown-body bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{meeting.result.raw_markdown}</ReactMarkdown>
            </div>
          ) : meeting.status === 'pending' ? (
            <div className="text-center py-12 text-slate-400">No analysis result yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
