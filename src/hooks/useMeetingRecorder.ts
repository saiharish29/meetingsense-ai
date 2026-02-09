import { useState, useRef, useCallback, useEffect } from 'react';

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped';

export interface RecorderChannelInfo {
  hasMic: boolean;
  hasSystem: boolean;
  hasVideo: boolean;
  micLabel: string;
  systemLabel: string;
}

export interface SpeakerSegment {
  channel: 'host' | 'participants';
  startTime: number;
  endTime: number;
  peakLevel: number;
}

export interface ScreenCapture {
  timestamp: number;
  blob: Blob;
}

export interface RecordingResult {
  hostAudio: Blob;
  systemAudio: Blob;
  mergedAudio: Blob;
  hostName: string;
  screenshots: ScreenCapture[];
  speakerTimeline: SpeakerSegment[];
  participants: string[];
  durationSeconds: number;
}

interface UseMeetingRecorderReturn {
  state: RecordingState;
  duration: number;
  micLevel: number;
  systemLevel: number;
  channelInfo: RecorderChannelInfo;
  screenshotCount: number;
  error: string | null;
  startRecording: (hostName: string, participants: string[]) => Promise<void>;
  stopRecording: () => Promise<RecordingResult>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;
}

const SCREENSHOT_INTERVAL_MS = 30_000;
const ENERGY_SAMPLE_INTERVAL_MS = 200;
const SPEECH_THRESHOLD = 0.06;
const MIN_SEGMENT_DURATION = 0.5;

export function useMeetingRecorder(): UseMeetingRecorderReturn {
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [channelInfo, setChannelInfo] = useState<RecorderChannelInfo>({
    hasMic: false, hasSystem: false, hasVideo: false, micLabel: '', systemLabel: ''
  });

  // Cancellation flag — checked by async operations
  const cancelledRef = useRef(false);

  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const systemAudioStreamRef = useRef<MediaStream | null>(null);
  const micRecorderRef = useRef<MediaRecorder | null>(null);
  const systemRecorderRef = useRef<MediaRecorder | null>(null);
  const mergedRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const sysAnalyserRef = useRef<AnalyserNode | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const systemChunksRef = useRef<Blob[]>([]);
  const mergedChunksRef = useRef<Blob[]>([]);
  const screenshotsRef = useRef<ScreenCapture[]>([]);
  const speakerTimelineRef = useRef<SpeakerSegment[]>([]);
  const hostNameRef = useRef('Host');
  const participantsRef = useRef<string[]>([]);
  const startTimeRef = useRef<number>(0);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const timerRef = useRef<number | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const screenshotIntervalRef = useRef<number | null>(null);
  const energyIntervalRef = useRef<number | null>(null);
  const hostSpeakingRef = useRef(false);
  const partSpeakingRef = useRef(false);
  const hostSegStartRef = useRef(0);
  const partSegStartRef = useRef(0);
  const hostPeakRef = useRef(0);
  const partPeakRef = useRef(0);

  useEffect(() => {
    return () => { stopAllTimers(); stopAllStreams(); };
  }, []);

  // ---- Helpers ----

  const stopAllTimers = useCallback(() => {
    [timerRef, screenshotIntervalRef, energyIntervalRef].forEach(ref => {
      if (ref.current) { clearInterval(ref.current); ref.current = null; }
    });
    if (levelFrameRef.current) { cancelAnimationFrame(levelFrameRef.current); levelFrameRef.current = null; }
  }, []);

  const stopAllStreams = useCallback(() => {
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    displayStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    displayStreamRef.current = null;
    systemAudioStreamRef.current = null;
    videoTrackRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    micAnalyserRef.current = null;
    sysAnalyserRef.current = null;
  }, []);

  const stopAllRecorders = useCallback(() => {
    // Null out ondataavailable and onstop BEFORE stopping to prevent side effects
    [micRecorderRef, systemRecorderRef, mergedRecorderRef].forEach(ref => {
      if (ref.current) {
        ref.current.ondataavailable = null;
        ref.current.onstop = null;
        try {
          if (ref.current.state !== 'inactive') ref.current.stop();
        } catch (e) { /* already stopped */ }
        ref.current = null;
      }
    });
  }, []);

  const resetAllData = useCallback(() => {
    micChunksRef.current = [];
    systemChunksRef.current = [];
    mergedChunksRef.current = [];
    screenshotsRef.current = [];
    speakerTimelineRef.current = [];
    hostSpeakingRef.current = false;
    partSpeakingRef.current = false;
    hostPeakRef.current = 0;
    partPeakRef.current = 0;
    setDuration(0);
    setMicLevel(0);
    setSystemLevel(0);
    setScreenshotCount(0);
    setError(null);
    setChannelInfo({ hasMic: false, hasSystem: false, hasVideo: false, micLabel: '', systemLabel: '' });
  }, []);

  // ---- Level metering ----
  const startLevelMetering = useCallback(() => {
    const micData = new Uint8Array(64);
    const sysData = new Uint8Array(64);
    const tick = () => {
      if (cancelledRef.current) return;
      if (micAnalyserRef.current) {
        micAnalyserRef.current.getByteFrequencyData(micData);
        setMicLevel(Math.min(1, micData.reduce((a, b) => a + b, 0) / micData.length / 128));
      }
      if (sysAnalyserRef.current) {
        sysAnalyserRef.current.getByteFrequencyData(sysData);
        setSystemLevel(Math.min(1, sysData.reduce((a, b) => a + b, 0) / sysData.length / 128));
      }
      levelFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // ---- Screenshot capture ----
  const captureScreenshot = useCallback(async () => {
    if (cancelledRef.current) return;
    const track = videoTrackRef.current;
    if (!track || track.readyState !== 'live') return;

    try {
      // Try ImageCapture API first
      // @ts-ignore
      if (typeof ImageCapture !== 'undefined') {
        // @ts-ignore
        const capture = new ImageCapture(track);
        const bitmap = await capture.grabFrame();
        if (cancelledRef.current) { bitmap.close(); return; }
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();
        const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.7));
        if (cancelledRef.current) return;
        const ts = (Date.now() - startTimeRef.current) / 1000;
        screenshotsRef.current.push({ timestamp: ts, blob });
        setScreenshotCount(screenshotsRef.current.length);
        return;
      }
    } catch (e) { /* fall through to video element approach */ }

    try {
      const video = document.createElement('video');
      video.srcObject = new MediaStream([track]);
      video.muted = true;
      await video.play();
      if (cancelledRef.current) { video.pause(); video.srcObject = null; return; }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      video.pause();
      video.srcObject = null;
      const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.7));
      if (cancelledRef.current) return;
      const ts = (Date.now() - startTimeRef.current) / 1000;
      screenshotsRef.current.push({ timestamp: ts, blob });
      setScreenshotCount(screenshotsRef.current.length);
    } catch (e2) { console.warn('Screenshot failed:', e2); }
  }, []);

  // ---- Energy detection for speaker timeline ----
  const startEnergyDetection = useCallback(() => {
    const micData = new Float32Array(256);
    const sysData = new Float32Array(256);

    energyIntervalRef.current = window.setInterval(() => {
      if (cancelledRef.current) return;
      const now = (Date.now() - startTimeRef.current) / 1000;

      if (micAnalyserRef.current) {
        micAnalyserRef.current.getFloatTimeDomainData(micData);
        const rms = Math.sqrt(micData.reduce((sum, v) => sum + v * v, 0) / micData.length);
        if (rms > SPEECH_THRESHOLD) {
          hostPeakRef.current = Math.max(hostPeakRef.current, rms);
          if (!hostSpeakingRef.current) { hostSpeakingRef.current = true; hostSegStartRef.current = now; }
        } else if (hostSpeakingRef.current) {
          hostSpeakingRef.current = false;
          if (now - hostSegStartRef.current >= MIN_SEGMENT_DURATION) {
            speakerTimelineRef.current.push({ channel: 'host', startTime: hostSegStartRef.current, endTime: now, peakLevel: hostPeakRef.current });
          }
          hostPeakRef.current = 0;
        }
      }

      if (sysAnalyserRef.current) {
        sysAnalyserRef.current.getFloatTimeDomainData(sysData);
        const rms = Math.sqrt(sysData.reduce((sum, v) => sum + v * v, 0) / sysData.length);
        if (rms > SPEECH_THRESHOLD) {
          partPeakRef.current = Math.max(partPeakRef.current, rms);
          if (!partSpeakingRef.current) { partSpeakingRef.current = true; partSegStartRef.current = now; }
        } else if (partSpeakingRef.current) {
          partSpeakingRef.current = false;
          if (now - partSegStartRef.current >= MIN_SEGMENT_DURATION) {
            speakerTimelineRef.current.push({ channel: 'participants', startTime: partSegStartRef.current, endTime: now, peakLevel: partPeakRef.current });
          }
          partPeakRef.current = 0;
        }
      }
    }, ENERGY_SAMPLE_INTERVAL_MS);
  }, []);

  // ===== START RECORDING =====
  const startRecording = useCallback(async (hostName: string = 'Host', participants: string[] = []) => {
    // Reset cancellation flag
    cancelledRef.current = false;
    setError(null);
    setState('requesting');
    hostNameRef.current = hostName;
    participantsRef.current = participants;
    resetAllData();

    try {
      // 1. Microphone
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (cancelledRef.current) { micStream.getTracks().forEach(t => t.stop()); return; }
        micStreamRef.current = micStream;
      } catch (e) { console.warn('Mic denied:', e); }

      // Check cancellation between permission dialogs
      if (cancelledRef.current) {
        micStream?.getTracks().forEach(t => t.stop());
        return;
      }

      // 2. Screen share
      let displayStream: MediaStream | null = null;
      let systemAudioStream: MediaStream | null = null;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 1, max: 5 } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        if (cancelledRef.current) { displayStream.getTracks().forEach(t => t.stop()); return; }
        displayStreamRef.current = displayStream;

        const videoTracks = displayStream.getVideoTracks();
        if (videoTracks.length > 0) {
          videoTrackRef.current = videoTracks[0];
          videoTracks[0].onended = () => {
            if (!cancelledRef.current) {
              videoTrackRef.current = null;
              setChannelInfo(prev => ({ ...prev, hasVideo: false }));
            }
          };
        }

        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length > 0) {
          systemAudioStream = new MediaStream(audioTracks);
          systemAudioStreamRef.current = systemAudioStream;
          audioTracks.forEach(track => {
            track.onended = () => {
              if (!cancelledRef.current) setChannelInfo(prev => ({ ...prev, hasSystem: false }));
            };
          });
        }
      } catch (e) { console.warn('Display share denied:', e); }

      // Final cancellation check
      if (cancelledRef.current) {
        micStream?.getTracks().forEach(t => t.stop());
        displayStream?.getTracks().forEach(t => t.stop());
        return;
      }

      if (!micStream && !systemAudioStream) {
        throw new Error('No audio source available. Please allow microphone or screen sharing.');
      }

      // 3. AudioContext
      const audioCtx = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();
      const merger = audioCtx.createChannelMerger(2);
      merger.connect(destination);

      if (micStream && micStream.getAudioTracks().length > 0) {
        const src = audioCtx.createMediaStreamSource(micStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(merger, 0, 0);
        micAnalyserRef.current = analyser;
      }

      if (systemAudioStream && systemAudioStream.getAudioTracks().length > 0) {
        const src = audioCtx.createMediaStreamSource(systemAudioStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(merger, 0, 1);
        sysAnalyserRef.current = analyser;
      }

      setChannelInfo({
        hasMic: !!(micStream && micStream.getAudioTracks().length > 0),
        hasSystem: !!(systemAudioStream && systemAudioStream.getAudioTracks().length > 0),
        hasVideo: !!videoTrackRef.current,
        micLabel: micStream?.getAudioTracks()[0]?.label || 'No microphone',
        systemLabel: systemAudioStream?.getAudioTracks()[0]?.label || 'No system audio',
      });

      // 4. Recorders
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';

      if (micStream && micStream.getAudioTracks().length > 0) {
        const rec = new MediaRecorder(micStream, { mimeType });
        rec.ondataavailable = e => { if (e.data.size > 0 && !cancelledRef.current) micChunksRef.current.push(e.data); };
        micRecorderRef.current = rec;
      }

      if (systemAudioStream && systemAudioStream.getAudioTracks().length > 0) {
        const rec = new MediaRecorder(systemAudioStream, { mimeType });
        rec.ondataavailable = e => { if (e.data.size > 0 && !cancelledRef.current) systemChunksRef.current.push(e.data); };
        systemRecorderRef.current = rec;
      }

      const mergedRec = new MediaRecorder(destination.stream, { mimeType });
      mergedRec.ondataavailable = e => { if (e.data.size > 0 && !cancelledRef.current) mergedChunksRef.current.push(e.data); };
      mergedRecorderRef.current = mergedRec;

      // Final check before starting
      if (cancelledRef.current) {
        stopAllStreams();
        return;
      }

      // 5. Start
      startTimeRef.current = Date.now();
      micRecorderRef.current?.start(1000);
      systemRecorderRef.current?.start(1000);
      mergedRecorderRef.current?.start(1000);

      setDuration(0);
      timerRef.current = window.setInterval(() => {
        if (!cancelledRef.current) setDuration(prev => prev + 1);
      }, 1000);

      startLevelMetering();
      startEnergyDetection();

      if (videoTrackRef.current) {
        setTimeout(() => { if (!cancelledRef.current) captureScreenshot(); }, 2000);
        screenshotIntervalRef.current = window.setInterval(() => {
          if (!cancelledRef.current) captureScreenshot();
        }, SCREENSHOT_INTERVAL_MS);
      }

      setState('recording');

    } catch (err: any) {
      if (!cancelledRef.current) {
        stopAllTimers();
        stopAllRecorders();
        stopAllStreams();
        setError(err.message || 'Failed to start recording');
        setState('idle');
      }
    }
  }, [resetAllData, stopAllTimers, stopAllRecorders, stopAllStreams, startLevelMetering, startEnergyDetection, captureScreenshot]);

  // ===== STOP RECORDING =====
  const stopRecording = useCallback((): Promise<RecordingResult> => {
    return new Promise((resolve) => {
      stopAllTimers();

      // Final screenshot
      captureScreenshot();

      // Close any open speech segments
      const now = (Date.now() - startTimeRef.current) / 1000;
      if (hostSpeakingRef.current && now - hostSegStartRef.current >= MIN_SEGMENT_DURATION) {
        speakerTimelineRef.current.push({ channel: 'host', startTime: hostSegStartRef.current, endTime: now, peakLevel: hostPeakRef.current });
      }
      if (partSpeakingRef.current && now - partSegStartRef.current >= MIN_SEGMENT_DURATION) {
        speakerTimelineRef.current.push({ channel: 'participants', startTime: partSegStartRef.current, endTime: now, peakLevel: partPeakRef.current });
      }

      // Gather active recorders and set up onstop handlers
      const activeRecorders: MediaRecorder[] = [];
      [micRecorderRef, systemRecorderRef, mergedRecorderRef].forEach(ref => {
        if (ref.current && ref.current.state !== 'inactive') activeRecorders.push(ref.current);
      });

      let stoppedCount = 0;

      const finalize = () => {
        const result: RecordingResult = {
          hostAudio: new Blob(micChunksRef.current, { type: 'audio/webm' }),
          systemAudio: new Blob(systemChunksRef.current, { type: 'audio/webm' }),
          mergedAudio: new Blob(mergedChunksRef.current, { type: 'audio/webm' }),
          hostName: hostNameRef.current,
          screenshots: [...screenshotsRef.current],
          speakerTimeline: speakerTimelineRef.current.sort((a, b) => a.startTime - b.startTime),
          participants: participantsRef.current,
          durationSeconds: now,
        };
        stopAllStreams();
        setState('stopped');
        resolve(result);
      };

      if (activeRecorders.length === 0) {
        finalize();
        return;
      }

      activeRecorders.forEach(rec => {
        rec.onstop = () => {
          stoppedCount++;
          if (stoppedCount >= activeRecorders.length) finalize();
        };
        rec.stop();
      });
    });
  }, [stopAllTimers, stopAllStreams, captureScreenshot]);

  // ===== PAUSE / RESUME =====
  const pauseRecording = useCallback(() => {
    [micRecorderRef, systemRecorderRef, mergedRecorderRef].forEach(r => {
      if (r.current && r.current.state === 'recording') r.current.pause();
    });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setState('paused');
  }, []);

  const resumeRecording = useCallback(() => {
    [micRecorderRef, systemRecorderRef, mergedRecorderRef].forEach(r => {
      if (r.current && r.current.state === 'paused') r.current.resume();
    });
    timerRef.current = window.setInterval(() => {
      if (!cancelledRef.current) setDuration(prev => prev + 1);
    }, 1000);
    setState('recording');
  }, []);

  // ===== CANCEL RECORDING =====
  const cancelRecording = useCallback(() => {
    // Set cancellation flag FIRST — this prevents any async operations from continuing
    cancelledRef.current = true;

    // Stop all timers
    stopAllTimers();

    // Stop recorders WITHOUT triggering onstop handlers
    stopAllRecorders();

    // Stop all media streams
    stopAllStreams();

    // Reset all data and state
    resetAllData();

    // Set state to idle LAST
    setState('idle');
  }, [stopAllTimers, stopAllRecorders, stopAllStreams, resetAllData]);

  return {
    state, duration, micLevel, systemLevel, channelInfo, screenshotCount, error,
    startRecording, stopRecording, pauseRecording, resumeRecording, cancelRecording,
  };
}
