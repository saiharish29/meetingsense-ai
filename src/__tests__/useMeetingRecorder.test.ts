import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMeetingRecorder } from '../hooks/useMeetingRecorder';

describe('useMeetingRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with idle state', () => {
    const { result } = renderHook(() => useMeetingRecorder());
    expect(result.current.state).toBe('idle');
    expect(result.current.duration).toBe(0);
    expect(result.current.micLevel).toBe(0);
    expect(result.current.systemLevel).toBe(0);
    expect(result.current.screenshotCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('should transition to requesting then recording on startRecording', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.startRecording('Harish', ['Sarah', 'John']);
    });

    expect(result.current.state).toBe('recording');
    expect(result.current.channelInfo.hasMic).toBe(true);
  });

  it('should transition to paused on pauseRecording', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => {
      await result.current.startRecording('Host', []);
    });
    expect(result.current.state).toBe('recording');

    act(() => { result.current.pauseRecording(); });
    expect(result.current.state).toBe('paused');
  });

  it('should transition back to recording on resumeRecording', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });
    act(() => { result.current.pauseRecording(); });
    expect(result.current.state).toBe('paused');

    act(() => { result.current.resumeRecording(); });
    expect(result.current.state).toBe('recording');
  });

  it('should reset to idle on cancelRecording from recording state', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });
    expect(result.current.state).toBe('recording');

    act(() => { result.current.cancelRecording(); });

    expect(result.current.state).toBe('idle');
    expect(result.current.duration).toBe(0);
    expect(result.current.micLevel).toBe(0);
    expect(result.current.systemLevel).toBe(0);
    expect(result.current.screenshotCount).toBe(0);
  });

  it('should reset to idle on cancelRecording from paused state', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });
    act(() => { result.current.pauseRecording(); });
    expect(result.current.state).toBe('paused');

    act(() => { result.current.cancelRecording(); });
    expect(result.current.state).toBe('idle');
  });

  it('should NOT transition to recording after cancel (the original bug)', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });
    expect(result.current.state).toBe('recording');

    // Cancel
    act(() => { result.current.cancelRecording(); });
    expect(result.current.state).toBe('idle');

    // Advance timers — no leftover intervals should change state
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.state).toBe('idle');
    expect(result.current.duration).toBe(0);
  });

  it('should produce a RecordingResult on stopRecording', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Harish', ['Sarah']); });

    let recordingResult: any;
    await act(async () => {
      recordingResult = await result.current.stopRecording();
    });

    expect(result.current.state).toBe('stopped');
    expect(recordingResult).toBeDefined();
    expect(recordingResult.hostName).toBe('Harish');
    expect(recordingResult.participants).toEqual(['Sarah']);
    expect(recordingResult.hostAudio).toBeInstanceOf(Blob);
    expect(recordingResult.systemAudio).toBeInstanceOf(Blob);
    expect(recordingResult.mergedAudio).toBeInstanceOf(Blob);
    expect(recordingResult.speakerTimeline).toEqual(expect.any(Array));
    expect(recordingResult.screenshots).toEqual(expect.any(Array));
  });

  it('should allow starting again after cancel', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    // Start, cancel, start again
    await act(async () => { await result.current.startRecording('Host', []); });
    act(() => { result.current.cancelRecording(); });
    expect(result.current.state).toBe('idle');

    await act(async () => { await result.current.startRecording('Host2', ['Guest']); });
    expect(result.current.state).toBe('recording');
  });

  it('should handle error when no audio source available', async () => {
    // Mock both getUserMedia and getDisplayMedia to fail
    const origGetUserMedia = navigator.mediaDevices.getUserMedia;
    const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
    (navigator.mediaDevices.getUserMedia as any) = vi.fn().mockRejectedValue(new Error('denied'));
    (navigator.mediaDevices.getDisplayMedia as any) = vi.fn().mockRejectedValue(new Error('denied'));

    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });

    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).toContain('No audio source');

    // Restore
    (navigator.mediaDevices.getUserMedia as any) = origGetUserMedia;
    (navigator.mediaDevices.getDisplayMedia as any) = origGetDisplayMedia;
  });

  it('should increment duration during recording', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });
    expect(result.current.duration).toBe(0);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.duration).toBe(3);
  });

  it('should stop incrementing duration after cancel', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.duration).toBe(2);

    act(() => { result.current.cancelRecording(); });
    // Duration should be reset to 0
    expect(result.current.duration).toBe(0);

    // Advancing timers should NOT increase duration
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.duration).toBe(0);
  });

  it('should stop incrementing duration during pause', async () => {
    const { result } = renderHook(() => useMeetingRecorder());

    await act(async () => { await result.current.startRecording('Host', []); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.duration).toBe(2);

    act(() => { result.current.pauseRecording(); });
    act(() => { vi.advanceTimersByTime(3000); });
    // Should still be 2 because paused
    expect(result.current.duration).toBe(2);

    act(() => { result.current.resumeRecording(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.duration).toBe(4);
  });
});
