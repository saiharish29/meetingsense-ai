/**
 * AppTimeoutError.test.tsx
 *
 * Regression tests for App.tsx error handling.
 *
 * Guards:
 *  1. When analyzeWithServer throws an AbortError the UI shows
 *     "25 minutes" (not "10 minutes").
 *  2. updateMeetingStatus is called on any error so the meeting is never
 *     permanently stuck in 'processing'.
 *  3. Gemini server errors (non-AbortError) are shown verbatim.
 *  4. The "Try Again" button returns the UI to the idle/input state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import * as api from '../services/api';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../services/api', () => ({
  checkApiKeyStatus:    vi.fn().mockResolvedValue({ configured: true, source: 'db', model: 'gemini-2.5-flash' }),
  saveApiKey:           vi.fn().mockResolvedValue({ success: true }),
  validateApiKey:       vi.fn().mockResolvedValue({ valid: true }),
  fetchAvailableModels: vi.fn().mockResolvedValue({ models: [], currentModel: 'gemini-2.5-flash' }),
  saveModelPreference:  vi.fn().mockResolvedValue({ success: true, model: 'gemini-2.5-flash' }),
  getModelPreference:   vi.fn().mockResolvedValue({ model: 'gemini-2.5-flash' }),
  listMeetings:         vi.fn().mockResolvedValue({ meetings: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 1 } }),
  getMeeting:           vi.fn().mockResolvedValue({ id: 't1', title: 'T', created_at: '2025-01-01', status: 'completed', inputs: [], result: null, participants: [] }),
  createMeeting:        vi.fn().mockResolvedValue({ id: 'mtg-abc', status: 'pending' }),
  analyzeWithServer:    vi.fn().mockResolvedValue('# Analysis\nFull report'),
  saveMeetingResult:    vi.fn().mockResolvedValue({ success: true }),
  updateMeetingStatus:  vi.fn().mockResolvedValue({ success: true }),
  deleteMeeting:        vi.fn().mockResolvedValue({ success: true }),
  getDashboardStats:    vi.fn().mockResolvedValue({ total: 0, completed: 0, processing: 0, totalDuration: 0, recentMeetings: [] }),
  healthCheck:          vi.fn().mockResolvedValue({ status: 'ok' }),
}));

vi.mock('../services/geminiService', () => ({
  analyzeMeeting:   vi.fn(),
  setApiKeyCache:   vi.fn(),
  clearApiKeyCache: vi.fn(),
  setSelectedModel: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for the app to finish loading (past the spinner). */
const waitForApp = () => waitFor(() => {
  expect(screen.getByText('Your meeting intelligence hub')).toBeInTheDocument();
});

/** Navigate to the New Meeting view via the sidebar. */
async function navigateToNewMeeting() {
  const navBtns = screen.getAllByText('New Meeting');
  fireEvent.click(navBtns[0]);
  // InputSection defaults to Live Record mode — "Start Recording" confirms we arrived
  await waitFor(() => expect(screen.getByText('Start Recording')).toBeInTheDocument());
}

/**
 * Switch to Paste Text mode, type a transcript, and click Analyze Meeting.
 * This is the simplest path that enables the Analyze button without needing
 * a real MediaRecorder or file upload.
 */
async function submitMockRecording() {
  // Switch to the Paste Text tab
  fireEvent.click(screen.getByText('Paste Text'));
  // Use the exact placeholder from InputSection's Paste Text mode
  const textarea = screen.getByPlaceholderText('Paste your meeting transcript, notes, or context here...');
  fireEvent.change(textarea, { target: { value: 'Test transcript for regression testing' } });
  // Click Analyze Meeting (enabled now that text is present)
  const analyzeBtn = screen.getByRole('button', { name: /Analyze Meeting/i });
  await act(async () => { fireEvent.click(analyzeBtn); });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(api.createMeeting).mockResolvedValue({ id: 'mtg-abc', status: 'pending' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('App — AbortError (timeout) handling', () => {
  it('shows "25 minutes" in the timeout error message', async () => {
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(abortErr);

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => {
      expect(screen.getByText('Processing Error')).toBeInTheDocument();
    });

    expect(screen.getByText(/timed out after 25 minutes/i)).toBeInTheDocument();
  });

  it('does NOT mention "10 minutes" in the timeout error message', async () => {
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(abortErr);

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => {
      expect(screen.getByText('Processing Error')).toBeInTheDocument();
    });

    expect(screen.queryByText(/10 minutes/i)).not.toBeInTheDocument();
  });

  it('calls updateMeetingStatus("error") on AbortError', async () => {
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(abortErr);

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => {
      expect(api.updateMeetingStatus).toHaveBeenCalledWith(
        'mtg-abc',
        'error',
        expect.stringContaining('25 minutes'),
      );
    });
  });
});

describe('App — server error handling', () => {
  it('shows the Gemini error message verbatim for non-AbortError', async () => {
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(
      new Error('📊 Daily API quota exhausted. Your free-tier limit has been reached.')
    );

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => {
      expect(screen.getByText('Processing Error')).toBeInTheDocument();
    });

    expect(screen.getByText(/Daily API quota exhausted/i)).toBeInTheDocument();
  });

  it('calls updateMeetingStatus("error") for any analysis error', async () => {
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(new Error('Network failure'));

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => {
      expect(api.updateMeetingStatus).toHaveBeenCalledWith(
        'mtg-abc',
        'error',
        expect.any(String),
      );
    });
  });
});

describe('App — error UI interaction', () => {
  it('shows Try Again and Back to Dashboard buttons on error', async () => {
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(new Error('Analysis failed'));

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
      expect(screen.getByText('Back to Dashboard')).toBeInTheDocument();
    });
  });

  it('returns to the input/idle state when Try Again is clicked', async () => {
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(new Error('Analysis failed'));

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => { expect(screen.getByText('Try Again')).toBeInTheDocument(); });
    fireEvent.click(screen.getByText('Try Again'));

    await waitFor(() => {
      expect(screen.getByText('Start Recording')).toBeInTheDocument();
    });
  });

  it('navigates back to dashboard when Back to Dashboard is clicked', async () => {
    vi.mocked(api.analyzeWithServer).mockRejectedValueOnce(new Error('Analysis failed'));

    render(<App />);
    await waitForApp();
    await navigateToNewMeeting();
    await submitMockRecording();

    await waitFor(() => { expect(screen.getByText('Back to Dashboard')).toBeInTheDocument(); });
    fireEvent.click(screen.getByText('Back to Dashboard'));

    await waitFor(() => {
      expect(screen.getByText('Your meeting intelligence hub')).toBeInTheDocument();
    });
  });
});
