/**
 * geminiService.ts
 *
 * Analysis is now performed server-side (Node.js + @google/genai).
 * This module is the frontend's thin interface to the backend analyze endpoint.
 *
 * Why moved to server:
 *  - Eliminates browser fetch timeouts (1.5 h recordings take 5–8 min to analyze)
 *  - Enables retry logic with exponential backoff
 *  - Keeps the API key on the server — never exposed in the browser network tab
 *  - Allows proper SSE keepalive to survive proxy idle-timeouts
 */

import { analyzeWithServer } from './api';

export type ProgressCallback = (stage: string, detail?: string) => void;

// Keep a module-level model preference that can be set after API-key setup.
let _selectedModel: string | null = null;

export function setSelectedModel(model: string) { _selectedModel = model; }
export function getSelectedModel(): string | null { return _selectedModel; }

// Legacy helpers kept for backward compatibility with App.tsx
export function clearApiKeyCache() { /* no-op: key lives server-side now */ }
export function setApiKeyCache(_key: string) { /* no-op */ }

/**
 * Analyze a meeting.
 *
 * The audio file and images are already stored on the server (uploaded during
 * createMeeting). This function just tells the server to run the analysis and
 * streams the progress events back to the UI.
 *
 * @param _text          - Metadata text (already sent to server with createMeeting — ignored here)
 * @param _audioFile     - Audio File object (already on server — ignored here)
 * @param _participantImgs - Image files (already on server — ignored here)
 * @param onProgress     - Progress callback for UI updates
 * @param meetingId      - UUID returned by createMeeting — REQUIRED for server-side analysis
 */
export async function analyzeMeeting(
  _text: string,
  _audioFile: File | null,
  _participantImgs: File[],
  onProgress?: ProgressCallback,
  meetingId?: string,
): Promise<string> {
  if (!meetingId) {
    throw new Error('Meeting ID is required for server-side analysis. Please try again.');
  }

  return analyzeWithServer(meetingId, _selectedModel, onProgress);
}
