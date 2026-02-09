import React, { useState, useEffect } from 'react';
import { listMeetings, deleteMeeting } from '../services/api';
import { Meeting } from '../types';

interface Props { onViewMeeting: (id: string) => void; }

export function MeetingHistory({ onViewMeeting }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { load(); }, [page, search, statusFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listMeetings({ page, limit: 15, search, status: statusFilter });
      setMeetings(res.meetings);
      setTotalPages(res.pagination.totalPages);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this meeting?')) return;
    await deleteMeeting(id);
    setMeetings(prev => prev.filter(m => m.id !== id));
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const sc: Record<string, string> = { completed: 'bg-green-100 text-green-700', processing: 'bg-amber-100 text-amber-700', pending: 'bg-slate-100 text-slate-600', error: 'bg-red-100 text-red-700' };

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Meeting History</h1>
      <p className="text-slate-500 text-sm mb-6">Browse and search your past meeting analyses</p>
      <div className="flex gap-3 mb-4">
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search meetings..." className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm">
          <option value="">All</option><option value="completed">Completed</option><option value="processing">Processing</option><option value="error">Error</option>
        </select>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? <div className="p-12 text-center text-slate-400">Loading...</div> : meetings.length === 0 ? <div className="p-12 text-center text-slate-500">No meetings found</div> : (
          <div className="divide-y divide-slate-100">
            {meetings.map(m => (
              <button key={m.id} onClick={() => onViewMeeting(m.id)} className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${sc[m.status] || sc.pending}`}>{m.status}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 truncate">{m.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{m.executive_summary || 'No summary'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <span className="text-xs text-slate-400">{fmt(m.created_at)}</span>
                  <button onClick={e => handleDelete(m.id, e)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40">Previous</button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
