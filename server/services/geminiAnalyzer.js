/**
 * geminiAnalyzer.js — Server-side Gemini analysis engine.
 *
 * Responsibilities:
 *  - Read recorded audio + screenshots from disk
 *  - Upload large audio files to Gemini File API with retry
 *  - Call generateContent with the selected model
 *  - Emit progress events via callback (for SSE streaming to frontend)
 *  - Implement fallback strategies for token-limit errors
 *
 * Supports meetings up to 9.5 hours (Gemini File API audio limit).
 * For 1.5-hour recordings (~86 MB WebM Opus), the File API path is always used.
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { SYSTEM_PROMPT, DEFAULT_MODEL } from '../constants.js';

// ─── Tunables ────────────────────────────────────────────────────────────────
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024;   // 15 MB: use inline base64 below this
const MAX_SCREENSHOTS     = 40;                  // Maximum images sent to Gemini
const MAX_IMAGE_BYTES     = 1.5 * 1024 * 1024;  // Skip individual images larger than 1.5 MB
const POLL_INTERVAL_MS    = 3_000;              // File API polling: every 3 s
const MAX_POLL_ATTEMPTS   = 120;                // 120 × 3 s = 6 minutes max
const MAX_RETRIES         = 3;                  // Retry attempts for API calls
const RETRY_BASE_MS       = 3_000;             // Base delay for exponential backoff
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Exponential-backoff retry wrapper */
async function withRetry(fn, maxAttempts = MAX_RETRIES, baseMs = RETRY_BASE_MS, label = 'operation') {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = baseMs * Math.pow(2, attempt - 1);
        console.warn(`[Analyzer] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

/** Upload an audio file to Gemini File API and wait until ACTIVE */
async function uploadAudioFile(ai, filePath, mimeType, emit) {
  return withRetry(async (attempt) => {
    if (attempt > 1) emit('Uploading audio', `Retry attempt ${attempt}/${MAX_RETRIES}...`);
    else emit('Uploading audio', `Uploading ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB to Gemini File API...`);

    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });

    const uploaded = await ai.files.upload({
      file: blob,
      config: { mimeType, displayName: path.basename(filePath) },
    });

    // Poll until ACTIVE
    let fileState = uploaded;
    let polls = 0;
    while (fileState.state === 'PROCESSING' && polls < MAX_POLL_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS);
      fileState = await ai.files.get({ name: fileState.name });
      polls++;
      const elapsed = ((polls * POLL_INTERVAL_MS) / 1000).toFixed(0);
      emit('Uploading audio', `Gemini is processing the file... (${elapsed}s elapsed)`);
    }

    if (fileState.state !== 'ACTIVE') {
      throw new Error(`File upload stalled: state=${fileState.state} after ${polls} polls`);
    }

    emit('Audio ready', `File API: ${fileState.uri}`);
    return { fileUri: fileState.uri, mimeType: fileState.mimeType };
  }, MAX_RETRIES, RETRY_BASE_MS, 'audio upload');
}

/** Evenly sample `count` items from an array */
function sampleEvenly(arr, count) {
  if (arr.length <= count) return arr;
  const step = arr.length / count;
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(arr[Math.floor(i * step)]);
  }
  return result;
}

/** Trim the speaker timeline section in the metadata text to stay within maxLen */
function trimMetadata(text, maxLen) {
  if (text.length <= maxLen) return text;

  const timelineStart = text.indexOf('SPEAKER ACTIVITY TIMELINE');
  const timelineEnd   = text.indexOf('\n\nSCREENSHOT EVIDENCE');

  if (timelineStart > -1 && timelineEnd > -1) {
    const before   = text.slice(0, timelineStart);
    const timeline = text.slice(timelineStart, timelineEnd);
    const after    = text.slice(timelineEnd);

    const lines   = timeline.split('\n');
    const header  = lines.slice(0, 3);
    const entries = lines.slice(3).filter(l => l.startsWith('- ['));

    if (entries.length > 200) {
      const half = 100;
      const trimmedEntries = [
        ...entries.slice(0, half),
        `- [... ${entries.length - 200} entries trimmed for brevity ...]`,
        ...entries.slice(-half),
      ];
      const trimmedTimeline = [...header, ...trimmedEntries].join('\n');
      const result = before + trimmedTimeline + after;
      if (result.length <= maxLen) return result;
    }
  }

  return text.slice(0, maxLen) + '\n\n[... metadata truncated due to length ...]';
}

/**
 * Core analysis runner.
 * Builds the multi-modal parts array and calls Gemini generateContent.
 */
async function runAnalysis({ ai, model, audioFilePath, audioMimeType, metadataText, imagePaths, emit }) {
  const parts = [];

  // ── 1. Audio ──────────────────────────────────────────────────────────────
  if (audioFilePath && fs.existsSync(audioFilePath)) {
    const stat = fs.statSync(audioFilePath);
    emit('Preparing audio', `${(stat.size / 1024 / 1024).toFixed(1)} MB`);

    if (stat.size > INLINE_LIMIT_BYTES) {
      try {
        const fileRef = await uploadAudioFile(ai, audioFilePath, audioMimeType || 'audio/webm', emit);
        parts.push({ fileData: fileRef });
      } catch (uploadErr) {
        // Fallback: inline only if the file is small enough
        if (stat.size <= 20 * 1024 * 1024) {
          emit('Audio fallback', 'File API failed — using inline base64');
          const b64 = fs.readFileSync(audioFilePath).toString('base64');
          parts.push({ inlineData: { mimeType: audioMimeType || 'audio/webm', data: b64 } });
        } else {
          throw new Error(
            `Audio upload failed and the file (${(stat.size / 1024 / 1024).toFixed(1)} MB) is too large for inline. ` +
            `Details: ${uploadErr.message}`
          );
        }
      }
    } else {
      emit('Encoding audio', 'Inline base64 (< 15 MB)');
      const b64 = fs.readFileSync(audioFilePath).toString('base64');
      parts.push({ inlineData: { mimeType: audioMimeType || 'audio/webm', data: b64 } });
    }
  }

  // ── 2. Images ─────────────────────────────────────────────────────────────
  let imgs = sampleEvenly(imagePaths.filter(p => fs.existsSync(p)), MAX_SCREENSHOTS);
  emit('Processing images', `${imgs.length} image(s)`);

  let imageCount = 0;
  for (const imgPath of imgs) {
    try {
      const stat = fs.statSync(imgPath);
      if (stat.size > MAX_IMAGE_BYTES) {
        console.warn(`[Analyzer] Skipping oversized image ${path.basename(imgPath)} (${(stat.size / 1024).toFixed(0)} KB)`);
        continue;
      }
      const b64 = fs.readFileSync(imgPath).toString('base64');
      const ext  = path.extname(imgPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      parts.push({ inlineData: { mimeType: mime, data: b64 } });
      imageCount++;
    } catch (e) {
      console.warn(`[Analyzer] Could not read image ${imgPath}: ${e.message}`);
    }
  }

  // ── 3. Prompt ─────────────────────────────────────────────────────────────
  let prompt = SYSTEM_PROMPT + '\n\n';
  if (metadataText && metadataText.trim()) {
    let meta = metadataText.trim();
    if (meta.length > 100_000) {
      emit('Trimming metadata', `${(meta.length / 1024).toFixed(0)} KB → 100 KB`);
      meta = trimMetadata(meta, 100_000);
    }
    prompt += `Meeting Context / Transcript:\n\n${meta}\n\n`;
  }
  if (audioFilePath && fs.existsSync(audioFilePath)) {
    prompt += 'Please analyze the provided audio/video recording above.\n';
  }
  if (imageCount > 0) {
    prompt += `${imageCount} screenshot/participant image(s) have been provided for speaker identification.\n`;
  }
  prompt += '\nPlease provide the full meeting analysis in the exact format specified.';
  parts.push({ text: prompt });

  emit('Sending to Gemini', `${parts.length} parts — model: ${model}`);

  // ── 4. Call Gemini with retry ─────────────────────────────────────────────
  return withRetry(async (attempt) => {
    if (attempt > 1) emit('Retrying Gemini call', `Attempt ${attempt}/${MAX_RETRIES}`);
    else emit('Analyzing', 'Waiting for Gemini response (may take several minutes for long meetings)...');

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
    });

    const text = response?.text;
    if (!text) throw new Error('Gemini returned an empty response. Please try again.');
    return text;
  }, MAX_RETRIES, RETRY_BASE_MS, 'generateContent');
}

/**
 * Main entry point — called by the /analyze route.
 *
 * @param {object} opts
 * @param {string}   opts.audioFilePath   - Absolute path to the stored audio file (or null)
 * @param {string}   opts.audioMimeType   - MIME type, e.g. "audio/webm"
 * @param {string}   opts.metadataText    - The recording metadata built by the frontend
 * @param {string[]} opts.imagePaths      - Absolute paths to stored screenshot/participant images
 * @param {string}   opts.model           - Gemini model ID (e.g. "gemini-2.5-flash")
 * @param {string}   opts.apiKey          - Active Gemini API key
 * @param {Function} opts.emit            - (stage: string, detail?: string) => void  — progress events
 * @returns {Promise<string>}             - Raw markdown analysis from Gemini
 */
export async function analyzeRecording({
  audioFilePath = null,
  audioMimeType = 'audio/webm',
  metadataText  = '',
  imagePaths    = [],
  model         = DEFAULT_MODEL,
  apiKey,
  emit          = () => {},
}) {
  if (!apiKey) throw new Error('Gemini API key is not configured. Please set it in Settings.');

  const ai = new GoogleGenAI({ apiKey });

  // Fallback strategies: reduce image count progressively on token-limit errors
  const strategies = [
    { imgs: imagePaths,                                   label: 'Full'         },
    { imgs: sampleEvenly(imagePaths, Math.ceil(imagePaths.length / 2)), label: 'Reduced images (50%)' },
    { imgs: [],                                           label: 'Audio only'   },
  ];

  let lastErr;
  for (const strategy of strategies) {
    try {
      if (strategy.label !== 'Full') {
        emit('Fallback strategy', `Retrying with: ${strategy.label}`);
      }
      const result = await runAnalysis({
        ai, model,
        audioFilePath,
        audioMimeType,
        metadataText,
        imagePaths: strategy.imgs,
        emit,
      });
      return result;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isCapacityError = (
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('token')              ||
        msg.includes('quota')             ||
        msg.includes('too large')         ||
        msg.includes('exceeds')           ||
        msg.includes('context length')
      );
      if (!isCapacityError) break; // Not a capacity issue — no point retrying with fewer images
      console.warn(`[Analyzer] Strategy "${strategy.label}" hit capacity error: ${msg}`);
    }
  }

  throw lastErr;
}
