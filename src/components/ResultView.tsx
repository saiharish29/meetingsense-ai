import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ResultViewProps {
  content: string;
  meetingId?: string;
  onReset: () => void;
}

const TABS = ['Summary', 'Full Report', 'Transcript', 'Metadata'];

export function ResultView({ content, meetingId, onReset }: ResultViewProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const sections = useMemo(() => {
    const execMatch = content.match(/# 1\. Executive Summary[\s\S]*?\n([\s\S]*?)(?=\n# 2)/);
    const detailedMatch = content.match(/(# 2\. Detailed Summary[\s\S]*?)(?=\n# 3)/);
    const transcriptMatch = content.match(/(# 3\. Cleaned Transcript[\s\S]*?)(?=\n# 4)/);
    const metaMatch = content.match(/# 4\. Metadata[\s\S]*?(```json[\s\S]*?```)/);
    return {
      executive: execMatch ? execMatch[1].trim() : 'No executive summary found.',
      detailed: detailedMatch ? detailedMatch[1].trim() : content,
      transcript: transcriptMatch ? transcriptMatch[1].trim() : 'No transcript available.',
      metadata: metaMatch ? metaMatch[1].trim() : '{}',
    };
  }, [content]);

  const getTabContent = () => {
    switch (activeTab) {
      case 0: return '# Executive Summary\n\n' + sections.executive + '\n\n' + (sections.detailed || '');
      case 1: return content;
      case 2: return sections.transcript;
      case 3: return '# Metadata\n\n' + sections.metadata;
      default: return content;
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meeting-analysis.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {TABS.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${activeTab === i ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-1.5">
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={handleExport} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">Export .md</button>
          <button onClick={onReset} className="px-3 py-1.5 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700">New Analysis</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="markdown-body bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{getTabContent()}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
