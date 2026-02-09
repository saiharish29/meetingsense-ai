import '@testing-library/jest-dom';

// Mock track factory
function createTrack(kind: 'audio' | 'video', label: string) {
  return { kind, label, stop: vi.fn(), readyState: 'live', onended: null };
}

// Mock MediaRecorder
class MockMediaRecorder {
  state = 'inactive' as string;
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  
  constructor(public stream: any, public options?: any) {}
  start(_timeslice?: number) { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    if (this.onstop) setTimeout(() => this.onstop?.(), 0);
  }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  static isTypeSupported(_type: string) { return true; }
}
// @ts-ignore
globalThis.MediaRecorder = MockMediaRecorder;

// Mock MediaStream — properly supports getAudioTracks/getVideoTracks
class MockMediaStream {
  _tracks: ReturnType<typeof createTrack>[];
  constructor(tracks?: any[]) { this._tracks = tracks || []; }
  getTracks() { return [...this._tracks]; }
  getAudioTracks() { return this._tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this._tracks.filter(t => t.kind === 'video'); }
}
// @ts-ignore
globalThis.MediaStream = MockMediaStream;

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockImplementation(async () => {
      return new MockMediaStream([createTrack('audio', 'Mock Mic')]);
    }),
    getDisplayMedia: vi.fn().mockImplementation(async () => {
      return new MockMediaStream([
        createTrack('video', 'Mock Screen'),
        createTrack('audio', 'System Audio'),
      ]);
    }),
  },
  writable: true,
  configurable: true,
});

// Mock AudioContext
function makeMockAudioContext() {
  return {
    state: 'running',
    sampleRate: 48000,
    createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
    createAnalyser: vi.fn().mockReturnValue({
      fftSize: 0,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn(),
      getFloatTimeDomainData: vi.fn(),
    }),
    createChannelMerger: vi.fn().mockReturnValue({ connect: vi.fn() }),
    createMediaStreamDestination: vi.fn().mockReturnValue({
      stream: new MockMediaStream([createTrack('audio', 'Merged')])
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// @ts-ignore
globalThis.AudioContext = function MockAudioContext() { return makeMockAudioContext(); };

// Mock requestAnimationFrame / cancelAnimationFrame
let rafId = 0;
globalThis.requestAnimationFrame = vi.fn().mockImplementation((_cb: any) => ++rafId);
globalThis.cancelAnimationFrame = vi.fn();
