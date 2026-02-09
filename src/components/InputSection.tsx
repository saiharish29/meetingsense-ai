import React, { useState, useRef } from 'react';
import { useMeetingRecorder } from '../hooks/useMeetingRecorder';
import type { RecordingResult } from '../hooks/useMeetingRecorder';

interface InputSectionProps {
  onAnalyze: (text: string, file: File | null, participantImgs: File[]) => void;
  isProcessing: boolean;
}

const ACCEPTED_TYPES = [
  'audio/mpeg','audio/wav','audio/webm','audio/ogg','audio/mp4','audio/x-m4a',
  'video/mp4','video/webm','video/quicktime',
];

type InputMode = 'upload' | 'record' | 'text';

export function InputSection({ onAnalyze, isProcessing }: InputSectionProps) {
  const [mode, setMode] = useState<InputMode>('record');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [participantImgs, setParticipantImgs] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [hostName, setHostName] = useState('');
  const [participantNames, setParticipantNames] = useState<string[]>([]);
  const [newParticipant, setNewParticipant] = useState('');
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordingMeta, setRecordingMeta] = useState('');
  const [recordingScreenshots, setRecordingScreenshots] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const recorder = useMeetingRecorder();

  const addParticipant = () => {
    const name = newParticipant.trim();
    if (name && !participantNames.includes(name)) {
      setParticipantNames(prev => [...prev, name]);
      setNewParticipant('');
    }
  };

  const removeParticipant = (i: number) => {
    setParticipantNames(prev => prev.filter((_, j) => j !== i));
  };

  const handleStartRecording = async () => {
    setRecordedFile(null);
    setRecordingMeta('');
    setRecordingScreenshots([]);
    await recorder.startRecording(hostName || 'Host', participantNames);
  };

  const handleStopRecording = async () => {
    const r: RecordingResult = await recorder.stopRecording();

    const mergedFile = new File(
      [r.mergedAudio],
      `meeting-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.webm`,
      { type: 'audio/webm' }
    );
    setRecordedFile(mergedFile);

    // Convert screenshots to Files for the participant images pipeline
    const ssFiles: File[] = [];
    for (let i = 0; i < r.screenshots.length; i++) {
      const ss = r.screenshots[i];
      const f = new File([ss.blob], `screenshot-${formatTimeSS(ss.timestamp)}.jpg`, { type: 'image/jpeg' });
      ssFiles.push(f);
    }
    setRecordingScreenshots(ssFiles);

    // Build rich metadata for Gemini
    const allParticipants = [r.hostName, ...r.participants].filter(Boolean);
    const timelineSummary = buildTimelineSummary(r);

    const meta = [
      `=== RECORDING METADATA ===`,
      ``,
      `AUDIO CHANNEL LAYOUT:`,
      `- This is a STEREO recording with dual-channel audio separation.`,
      `- LEFT CHANNEL (Channel 1): Host microphone — this is "${r.hostName}" speaking.`,
      `- RIGHT CHANNEL (Channel 2): System audio — these are the OTHER meeting participants speaking.`,
      `- Use this channel separation as the PRIMARY method for identifying "${r.hostName}" vs others.`,
      ``,
      `PARTICIPANT ROSTER:`,
      allParticipants.length > 0
        ? allParticipants.map((n, i) => `- ${i === 0 ? n + ' (HOST — left audio channel)' : n + ' (participant — right audio channel)'}`).join('\n')
        : '- Not specified',
      ``,
      `SPEAKER ACTIVITY TIMELINE (detected from audio energy):`,
      `This timeline shows WHEN each channel had speech activity. Use it to align voices with timestamps:`,
      timelineSummary || '- No speech segments detected',
      ``,
      `SCREENSHOT EVIDENCE (${r.screenshots.length} captures):`,
      r.screenshots.length > 0
        ? [
            `${r.screenshots.length} screenshots were captured from the meeting screen at regular intervals.`,
            `Meeting apps (Zoom/Teams/Meet) typically highlight the ACTIVE SPEAKER with a colored border or enlarged video.`,
            `CROSS-REFERENCE these screenshots with the audio timeline above to identify who was speaking:`,
            ...r.screenshots.map((ss, i) => `- Screenshot ${i + 1}: captured at ${formatTimeSS(ss.timestamp)} into the meeting`)
          ].join('\n')
        : '- No screenshots captured (screen sharing may not have been active)',
      ``,
      `SPEAKER IDENTIFICATION INSTRUCTIONS:`,
      `1. Use LEFT/RIGHT channel separation as the primary method to distinguish "${r.hostName}" from others.`,
      `2. Cross-reference screenshots (which show active speaker highlights) with the audio timeline.`,
      `3. When you see a speaker highlighted in a screenshot at time T, the audio on the RIGHT channel near time T belongs to that person.`,
      `4. Use voice consistency — once you identify a voice as a specific person, maintain that assignment throughout.`,
      `5. If participant names were provided, use them. Otherwise use Speaker B, Speaker C, etc.`,
      `6. NEVER assign "${r.hostName}" to audio from the RIGHT channel — they are always on the LEFT channel.`,
    ].join('\n');

    setRecordingMeta(meta);
  };

  const formatTimeSS = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatTime = (secs: number) => formatTimeSS(secs);

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  function buildTimelineSummary(r: RecordingResult): string {
    if (r.speakerTimeline.length === 0) return '';
    return r.speakerTimeline.map(seg => {
      const who = seg.channel === 'host' ? `${r.hostName} (host mic)` : 'Participant(s) (system audio)';
      return `- [${formatTimeSS(seg.startTime)} → ${formatTimeSS(seg.endTime)}] ${who} speaking (energy: ${(seg.peakLevel * 100).toFixed(0)}%)`;
    }).join('\n');
  }

  const activeFile = recordedFile || file;
  const allImgs = [...participantImgs, ...recordingScreenshots];
  const fullText = recordingMeta ? (text ? recordingMeta + '\n\nADDITIONAL CONTEXT:\n' + text : recordingMeta) : text;
  const canSubmit = (fullText.trim() || activeFile) && !isProcessing;

  const handleSubmit = () => {
    if (canSubmit) onAnalyze(fullText, activeFile, allImgs);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Analyze Meeting</h1>
        <p className="text-slate-500 text-sm mt-0.5">Record live, upload audio/video, or paste transcript</p>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
        {([
          { id: 'record' as InputMode, label: 'Live Record', icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
          { id: 'upload' as InputMode, label: 'Upload File', icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12' },
          { id: 'text' as InputMode, label: 'Paste Text', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setMode(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${mode === tab.id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} /></svg>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== LIVE RECORDING MODE ===== */}
      {mode === 'record' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          {/* Pre-recording setup */}
          {recorder.state === 'idle' && !recordedFile && (
            <>
              {/* Host name */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Your Name (Host)</label>
                <input type="text" value={hostName} onChange={e => setHostName(e.target.value)} placeholder="e.g., Harish"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
              </div>

              {/* Participant roster */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Meeting Participants</label>
                <div className="flex gap-2">
                  <input type="text" value={newParticipant} onChange={e => setNewParticipant(e.target.value)} placeholder="Add participant name..."
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addParticipant())}
                    className="flex-1 px-4 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                  <button onClick={addParticipant} disabled={!newParticipant.trim()}
                    className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-40 transition-colors">Add</button>
                </div>
                {participantNames.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {participantNames.map((name, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-50 text-brand-700 text-sm font-medium rounded-full">
                        {name}
                        <button onClick={() => removeParticipant(i)} className="hover:text-red-500 transition-colors">&times;</button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-1.5">Adding names helps the AI correctly tag each speaker in the transcript</p>
              </div>

              {/* Start button */}
              <div className="text-center">
                <button onClick={handleStartRecording}
                  className="inline-flex items-center gap-3 px-8 py-4 bg-red-500 text-white font-semibold rounded-2xl hover:bg-red-600 transition-all shadow-lg shadow-red-200">
                  <div className="w-4 h-4 bg-white rounded-full" />
                  Start Recording
                </button>
                <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-left">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    <span className="font-semibold">How it works:</span> Your mic records your voice (Host channel).
                    Then share your meeting screen — this captures participants' audio AND periodic screenshots
                    that show who the active speaker is. The AI uses all three signals to identify speakers accurately.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Requesting permissions - waiting for browser dialogs */}
          {recorder.state === 'requesting' && (
            <div className="text-center py-8">
              <div className="w-10 h-10 border-3 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-semibold text-slate-700 mb-1">Requesting permissions...</p>
              <p className="text-xs text-slate-400 mb-4">Please allow microphone access and select a screen to share</p>
              <button onClick={recorder.cancelRecording}
                className="px-5 py-2 bg-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-300 transition-colors text-sm">
                Cancel
              </button>
            </div>
          )}

          {/* Active Recording */}
          {(recorder.state === 'recording' || recorder.state === 'paused') && (
            <div>
              <div className="text-center mb-5">
                <div className="inline-flex items-center gap-2 bg-red-50 px-4 py-2 rounded-full">
                  <div className={`w-3 h-3 rounded-full ${recorder.state === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`} />
                  <span className="font-mono text-2xl font-bold text-slate-900">{formatTime(recorder.duration)}</span>
                  <span className="text-xs font-medium text-slate-500 uppercase">{recorder.state === 'paused' ? 'Paused' : 'Recording'}</span>
                </div>
              </div>

              {/* Channel status cards */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <div className={`p-3 rounded-xl border ${recorder.channelInfo.hasMic ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <svg className={`w-3.5 h-3.5 ${recorder.channelInfo.hasMic ? 'text-green-600' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    <span className="text-[11px] font-semibold text-slate-700">Your Mic</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all duration-75" style={{ width: `${recorder.micLevel * 100}%` }} />
                  </div>
                </div>
                <div className={`p-3 rounded-xl border ${recorder.channelInfo.hasSystem ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <svg className={`w-3.5 h-3.5 ${recorder.channelInfo.hasSystem ? 'text-blue-600' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="text-[11px] font-semibold text-slate-700">Participants</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all duration-75" style={{ width: `${recorder.systemLevel * 100}%` }} />
                  </div>
                </div>
                <div className={`p-3 rounded-xl border ${recorder.channelInfo.hasVideo ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <svg className={`w-3.5 h-3.5 ${recorder.channelInfo.hasVideo ? 'text-purple-600' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <span className="text-[11px] font-semibold text-slate-700">Screenshots</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium">{recorder.screenshotCount} captured</p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3">
                {recorder.state === 'recording' ? (
                  <button onClick={recorder.pauseRecording} className="px-4 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>Pause</button>
                ) : (
                  <button onClick={recorder.resumeRecording} className="px-4 py-2.5 bg-green-500 text-white font-semibold rounded-xl hover:bg-green-600 transition-colors flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>Resume</button>
                )}
                <button onClick={handleStopRecording} className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 bg-white rounded-sm" />Stop & Analyze</button>
                <button onClick={recorder.cancelRecording} className="px-4 py-2.5 bg-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-300 transition-colors text-sm">Cancel</button>
              </div>
            </div>
          )}

          {/* Recording Complete */}
          {recordedFile && recorder.state === 'stopped' && (
            <div className="text-center">
              <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 px-4 py-2.5 rounded-xl mb-2">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                <span className="font-medium text-green-700 text-sm">Recording ready — {formatSize(recordedFile.size)}</span>
              </div>
              <p className="text-xs text-slate-400 mb-1">Duration: {formatTime(recorder.duration)} • Stereo (Host + Participants)</p>
              <p className="text-xs text-slate-400 mb-3">{recordingScreenshots.length} screenshots captured for speaker identification</p>
              <button onClick={() => { setRecordedFile(null); setRecordingMeta(''); setRecordingScreenshots([]); recorder.cancelRecording(); }}
                className="text-sm text-red-500 hover:text-red-700 font-medium">Discard & re-record</button>
            </div>
          )}

          {recorder.error && (
            <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-100"><p className="text-sm text-red-600">{recorder.error}</p></div>
          )}
        </div>
      )}

      {/* ===== UPLOAD MODE ===== */}
      {mode === 'upload' && (
        <div className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer
          ${dragOver ? 'border-brand-400 bg-brand-50' : file ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white hover:border-brand-300'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f && ACCEPTED_TYPES.includes(f.type)) setFile(f); }}
          onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept={ACCEPTED_TYPES.join(',')} onChange={e => { const f = e.target.files?.[0]; if (f && ACCEPTED_TYPES.includes(f.type)) setFile(f); }} className="hidden" />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></div>
              <div className="text-left"><p className="font-medium text-slate-900 text-sm">{file.name}</p><p className="text-xs text-slate-400">{formatSize(file.size)}</p></div>
              <button onClick={e => { e.stopPropagation(); setFile(null); }} className="ml-2 p-1.5 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          ) : (<><div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg></div>
            <p className="text-sm font-medium text-slate-700">Drop audio or video file here</p>
            <p className="text-xs text-slate-400 mt-1">MP3, WAV, WebM, MP4, MOV — up to 500MB</p></>)}
        </div>
      )}

      {/* ===== TEXT MODE ===== */}
      {mode === 'text' && (
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste your meeting transcript, notes, or context here..."
          className="w-full h-48 px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
      )}

      {/* Additional context */}
      {(mode === 'record' || mode === 'upload') && (
        <div className="mt-4">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Add context, agenda, or notes (optional)..."
            className="w-full h-20 px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
        </div>
      )}

      {/* Manual participant images (for upload/text modes) */}
      {mode !== 'record' && (
        <div className="mt-4">
          <button onClick={() => imgRef.current?.click()} className="text-sm text-slate-500 hover:text-brand-600 flex items-center gap-1.5 font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Add participant photos (optional)
          </button>
          <input ref={imgRef} type="file" accept="image/*" multiple onChange={e => { if (e.target.files) setParticipantImgs(prev => [...prev, ...Array.from(e.target.files!)]); }} className="hidden" />
          {participantImgs.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {participantImgs.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={URL.createObjectURL(img)} alt={img.name} className="w-12 h-12 rounded-lg object-cover border border-slate-200" />
                  <button onClick={() => setParticipantImgs(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">x</button>
                </div>))}
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      <button onClick={handleSubmit} disabled={!canSubmit}
        className="w-full mt-6 px-5 py-3.5 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        Analyze Meeting
      </button>
    </div>
  );
}
