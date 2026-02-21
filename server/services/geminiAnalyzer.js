/**
 * geminiAnalyzer.js — Server-side Gemini analysis engine.
 *
 * Responsibilities:
 *  - Read recorded audio + screenshots from disk
 *  - Upload large audio files to Gemini File API with retry
 *  - Call generateContent with the selected model
 *  - Emit progress events via callback (for SSE streaming to frontend)
 *  - Classify ALL Gemini API errors into user-friendly messages
 *  - Implement smart retry: back-off for transient errors,
 *    no retry for quota/auth/billing errors (saves quota)
 *
 * Error reference: https://ai.google.dev/gemini-api/docs/troubleshooting
 *
 *  HTTP  gRPC Status            Meaning
 *  ────  ─────────────────────  ────────────────────────────────────────────
 *  400   INVALID_ARGUMENT       Malformed request body / unsupported format
 *  400   FAILED_PRECONDITION    Billing not enabled / region restriction
 *  403   PERMISSION_DENIED      API key invalid, restricted, or leaked
 *  404   NOT_FOUND              File URI expired or resource missing
 *  429   RESOURCE_EXHAUSTED     RPM / TPM / RPD quota hit
 *  500   INTERNAL               Gemini server bug (often oversized input)
 *  503   UNAVAILABLE            Gemini temporarily overloaded
 *  504   DEADLINE_EXCEEDED      Request timed out (context too large)
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { SYSTEM_PROMPT, DEFAULT_MODEL } from '../constants.js';

// ─── Tunables ────────────────────────────────────────────────────────────────
const INLINE_LIMIT_BYTES    = 15 * 1024 * 1024;  // 15 MB threshold for File API
const MAX_SCREENSHOTS       = 40;                 // Max images per Gemini request
const MAX_IMAGE_BYTES       = 1.5 * 1024 * 1024; // Skip images larger than 1.5 MB
const POLL_INTERVAL_MS      = 3_000;             // File API polling interval
const MAX_POLL_ATTEMPTS     = 120;               // 120 × 3 s = 6 min max wait
const MAX_RETRIES           = 3;                 // Transient-error retry limit
const RETRY_BASE_MS         = 3_000;            // Base for exponential backoff
const RATE_LIMIT_WAIT_MS    = 65_000;           // Wait time after a 429 RPM hit
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Error Classification ────────────────────────────────────────────────────

/**
 * Maps a raw Gemini SDK error to a structured object with:
 *  - type        : machine-readable category
 *  - retryable   : whether retrying makes sense
 *  - waitMs      : override wait before retry (null = use default backoff)
 *  - userMessage : clear, actionable message shown to the user
 */
function classifyGeminiError(err) {
  const raw    = String(err?.message || err?.toString() || '');
  const lower  = raw.toLowerCase();
  // The @google/genai SDK often prefixes messages with "[429 RESOURCE_EXHAUSTED]"
  const status = err?.status ?? err?.statusCode ?? extractHttpStatus(raw);

  // ── 429 RESOURCE_EXHAUSTED (rate limit or quota) ───────────────────────────
  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('rate limit') || raw.includes('429')) {
    // "daily" / "quota" in the message → RPD exhausted, no point retrying today
    if (lower.includes('quota') || lower.includes('daily') || lower.includes('per day') || lower.includes('exhausted')) {
      return {
        type: 'QUOTA_EXHAUSTED',
        retryable: false,
        waitMs: null,
        userMessage:
          '📊 Daily API quota exhausted.\n\n' +
          'Your free-tier daily request limit has been reached. It resets at midnight Pacific Time (PT).\n\n' +
          'Options:\n' +
          '• Wait until midnight PT and try again\n' +
          '• Upgrade to a paid plan at aistudio.google.com for higher quotas\n' +
          '• Use a different Gemini API key in Settings',
      };
    }
    // Otherwise it's an RPM / TPM limit — wait and retry
    return {
      type: 'RATE_LIMITED',
      retryable: true,
      waitMs: RATE_LIMIT_WAIT_MS,
      userMessage:
        '⏱️ Rate limit hit (too many requests per minute).\n\n' +
        'Waiting 65 seconds before retrying automatically...\n' +
        'You can view your current limits at: aistudio.google.com/rate-limit',
    };
  }

  // ── 403 PERMISSION_DENIED ─────────────────────────────────────────────────
  if (status === 403 || lower.includes('permission_denied') || lower.includes('permission denied') || raw.includes('403')) {
    // Leaked key gets a specific message from Google
    if (lower.includes('leaked') || lower.includes('reported')) {
      return {
        type: 'KEY_LEAKED',
        retryable: false,
        waitMs: null,
        userMessage:
          '🚨 Your API key has been flagged as leaked by Google.\n\n' +
          'Create a new API key at aistudio.google.com/apikey and update it in Settings.',
      };
    }
    return {
      type: 'AUTH_ERROR',
      retryable: false,
      waitMs: null,
      userMessage:
        '🔑 API key permission denied.\n\n' +
        'Your key may be invalid, expired, or restricted.\n' +
        'Please check your API key in Settings → it should start with "AI...".\n' +
        'Generate a new one at aistudio.google.com/apikey if needed.',
    };
  }

  // ── 400 FAILED_PRECONDITION (billing / region) ────────────────────────────
  if ((status === 400 || raw.includes('400')) && (lower.includes('failed_precondition') || lower.includes('billing') || lower.includes('region') || lower.includes('precondition'))) {
    return {
      type: 'BILLING_REQUIRED',
      retryable: false,
      waitMs: null,
      userMessage:
        '💳 Gemini API requires billing to be enabled for your account or region.\n\n' +
        'Enable billing at: aistudio.google.com → Settings → Billing.\n' +
        'The free tier is available in most regions — ensure your account is verified.',
    };
  }

  // ── 400 INVALID_ARGUMENT ──────────────────────────────────────────────────
  if (status === 400 || lower.includes('invalid_argument')) {
    return {
      type: 'INVALID_REQUEST',
      retryable: false,
      waitMs: null,
      userMessage:
        `❌ The request was rejected as invalid.\n\n` +
        `This usually means the audio format is unsupported, or a required field is missing.\n` +
        `Detail: ${raw.slice(0, 200)}`,
    };
  }

  // ── 404 NOT_FOUND (expired File API URI) ──────────────────────────────────
  if (status === 404 || lower.includes('not_found') || raw.includes('404')) {
    return {
      type: 'FILE_EXPIRED',
      retryable: false,
      waitMs: null,
      userMessage:
        '📁 The uploaded audio file reference has expired on Gemini\'s servers.\n\n' +
        'Gemini File API files expire after 48 hours. Please re-submit the recording for analysis.',
    };
  }

  // ── 500 INTERNAL (server bug, often oversized input) ─────────────────────
  if (status === 500 || lower.includes('internal')) {
    return {
      type: 'SERVER_ERROR',
      retryable: true,
      waitMs: null,
      userMessage:
        '⚠️ Gemini encountered an internal server error.\n\n' +
        'This sometimes happens with very large inputs. Retrying with a smaller payload...',
    };
  }

  // ── 503 UNAVAILABLE (Gemini overloaded) ───────────────────────────────────
  if (status === 503 || lower.includes('unavailable')) {
    return {
      type: 'SERVICE_UNAVAILABLE',
      retryable: true,
      waitMs: 10_000, // wait 10s before first retry for 503
      userMessage:
        '🔄 Gemini is temporarily overloaded.\n\nRetrying in a moment...',
    };
  }

  // ── 504 DEADLINE_EXCEEDED (request too complex / timed out server-side) ───
  if (status === 504 || lower.includes('deadline_exceeded')) {
    return {
      type: 'DEADLINE_EXCEEDED',
      retryable: false,
      waitMs: null,
      userMessage:
        '⏰ Gemini could not finish processing within its time limit.\n\n' +
        'This can happen with very long recordings on smaller models.\n' +
        'Try switching to a more powerful model (e.g. gemini-2.5-pro) in Settings.',
    };
  }

  // ── Capacity / context window errors (token limit exceeded) ───────────────
  if (lower.includes('token') || lower.includes('context length') || lower.includes('exceeds') || lower.includes('too large')) {
    return {
      type: 'CONTEXT_OVERFLOW',
      retryable: true, // let the fallback strategy handle it
      waitMs: null,
      userMessage:
        '📏 The recording is too large for the model\'s context window.\n\nReducing payload and retrying...',
    };
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  return {
    type: 'UNKNOWN',
    retryable: true,
    waitMs: null,
    userMessage: raw || 'An unexpected error occurred. Please try again.',
  };
}

/** Extract HTTP status code embedded in SDK error messages like "[429 RESOURCE_EXHAUSTED]" */
function extractHttpStatus(message) {
  const match = message.match(/\[(\d{3})\s/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Smart retry wrapper — respects error classification.
 * Non-retryable errors are thrown immediately (no wasted retries).
 * Rate-limit errors use a longer wait (65 s) instead of short backoff.
 */
async function withSmartRetry(fn, maxAttempts = MAX_RETRIES, baseMs = RETRY_BASE_MS, label = 'operation', emit = () => {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const classified = classifyGeminiError(err);

      if (!classified.retryable) {
        // Throw immediately — retrying won't help and wastes quota
        throw new GeminiUserError(classified.userMessage, classified.type);
      }

      if (attempt >= maxAttempts) break;

      const waitMs = classified.waitMs ?? (baseMs * Math.pow(2, attempt - 1));
      const waitSec = Math.round(waitMs / 1000);

      console.warn(`[Analyzer] ${label} attempt ${attempt}/${maxAttempts} — ${classified.type}: ${err.message}`);
      emit(
        classified.type === 'RATE_LIMITED' ? 'Rate limit — waiting' : 'Retrying',
        classified.type === 'RATE_LIMITED'
          ? `Waiting ${waitSec}s before retry (attempt ${attempt + 1}/${maxAttempts})...`
          : `Attempt ${attempt + 1}/${maxAttempts} in ${waitSec}s...`
      );
      await sleep(waitMs);
    }
  }

  // All attempts exhausted — classify the last error for the user
  const classified = classifyGeminiError(lastErr);
  throw new GeminiUserError(classified.userMessage, classified.type);
}

/** Custom error class so the route handler can detect user-facing messages */
class GeminiUserError extends Error {
  constructor(userMessage, type) {
    super(userMessage);
    this.name  = 'GeminiUserError';
    this.type  = type;
  }
}

// ─── File API Upload ─────────────────────────────────────────────────────────

async function uploadAudioFile(ai, filePath, mimeType, emit) {
  return withSmartRetry(async (attempt) => {
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
  }, MAX_RETRIES, RETRY_BASE_MS, 'audio upload', emit);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sampleEvenly(arr, count) {
  if (arr.length <= count) return arr;
  const step = arr.length / count;
  const result = [];
  for (let i = 0; i < count; i++) result.push(arr[Math.floor(i * step)]);
  return result;
}

function trimMetadata(text, maxLen) {
  if (text.length <= maxLen) return text;

  const timelineStart = text.indexOf('SPEAKER ACTIVITY TIMELINE');
  const timelineEnd   = text.indexOf('\n\nSCREENSHOT EVIDENCE');

  if (timelineStart > -1 && timelineEnd > -1) {
    const before   = text.slice(0, timelineStart);
    const timeline = text.slice(timelineStart, timelineEnd);
    const after    = text.slice(timelineEnd);
    const lines    = timeline.split('\n');
    const header   = lines.slice(0, 3);
    const entries  = lines.slice(3).filter(l => l.startsWith('- ['));

    if (entries.length > 200) {
      const half = 100;
      const trimmed = [
        ...entries.slice(0, half),
        `- [... ${entries.length - 200} entries trimmed for brevity ...]`,
        ...entries.slice(-half),
      ];
      const result = before + [...header, ...trimmed].join('\n') + after;
      if (result.length <= maxLen) return result;
    }
  }

  return text.slice(0, maxLen) + '\n\n[... metadata truncated due to length ...]';
}

// ─── Core Analysis Runner ────────────────────────────────────────────────────

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
        // Re-throw user-friendly errors immediately
        if (uploadErr instanceof GeminiUserError) throw uploadErr;
        // Fallback to inline only for files small enough
        if (stat.size <= 20 * 1024 * 1024) {
          emit('Audio fallback', 'File API failed — using inline base64');
          const b64 = fs.readFileSync(audioFilePath).toString('base64');
          parts.push({ inlineData: { mimeType: audioMimeType || 'audio/webm', data: b64 } });
        } else {
          throw new Error(
            `Audio upload failed. The file is ${(stat.size / 1024 / 1024).toFixed(1)} MB — ` +
            `too large for inline fallback. Details: ${uploadErr.message}`
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
  const imgs = sampleEvenly(imagePaths.filter(p => fs.existsSync(p)), MAX_SCREENSHOTS);
  emit('Processing images', `${imgs.length} image(s)`);

  let imageCount = 0;
  for (const imgPath of imgs) {
    try {
      const stat = fs.statSync(imgPath);
      if (stat.size > MAX_IMAGE_BYTES) {
        console.warn(`[Analyzer] Skipping oversized image ${path.basename(imgPath)} (${(stat.size / 1024).toFixed(0)} KB)`);
        continue;
      }
      const b64  = fs.readFileSync(imgPath).toString('base64');
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

  // ── 4. Call Gemini ────────────────────────────────────────────────────────
  return withSmartRetry(async (attempt) => {
    if (attempt > 1) emit('Retrying', `Attempt ${attempt}/${MAX_RETRIES}`);
    else emit('Analyzing', 'Waiting for Gemini response (may take several minutes for long meetings)...');

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
    });

    const text = response?.text;
    if (!text) throw new Error('Gemini returned an empty response. Please try again.');
    return text;
  }, MAX_RETRIES, RETRY_BASE_MS, 'generateContent', emit);
}

// ─── Public Entry Point ──────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}   opts.audioFilePath   Absolute path to stored audio (or null)
 * @param {string}   opts.audioMimeType   MIME type e.g. "audio/webm"
 * @param {string}   opts.metadataText    Recording metadata from the frontend
 * @param {string[]} opts.imagePaths      Absolute paths to screenshot/participant images
 * @param {string}   opts.model           Gemini model ID
 * @param {string}   opts.apiKey          Active Gemini API key
 * @param {Function} opts.emit            (stage, detail?) => void — SSE progress
 * @returns {Promise<string>}             Raw markdown from Gemini
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
  if (!apiKey) throw new Error('Gemini API key is not configured. Please add it in Settings.');

  const ai = new GoogleGenAI({ apiKey });

  // Fallback strategies: progressively reduce image payload on capacity errors.
  // Note: quota/auth errors are thrown immediately and skip the fallback chain.
  const strategies = [
    { imgs: imagePaths,                                            label: 'Full'              },
    { imgs: sampleEvenly(imagePaths, Math.ceil(imagePaths.length / 2)), label: 'Reduced images (50%)' },
    { imgs: [],                                                    label: 'Audio only'        },
  ];

  let lastErr;
  for (const strategy of strategies) {
    try {
      if (strategy.label !== 'Full') {
        emit('Fallback strategy', `Retrying with: ${strategy.label}`);
      }
      const result = await runAnalysis({
        ai, model, audioFilePath, audioMimeType, metadataText,
        imagePaths: strategy.imgs, emit,
      });
      return result;
    } catch (err) {
      lastErr = err;

      // User-facing errors (quota, auth, billing, deadline) — stop immediately
      if (err instanceof GeminiUserError) {
        const nonRetryableTypes = ['QUOTA_EXHAUSTED', 'AUTH_ERROR', 'KEY_LEAKED', 'BILLING_REQUIRED', 'DEADLINE_EXCEEDED', 'FILE_EXPIRED', 'INVALID_REQUEST'];
        if (nonRetryableTypes.includes(err.type)) throw err;
      }

      // Only run fallback for capacity/context errors
      const msg = String(err?.message || '');
      const isCapacityError = (
        err.type === 'CONTEXT_OVERFLOW'               ||
        err.type === 'SERVER_ERROR'                   ||
        msg.includes('RESOURCE_EXHAUSTED')            ||
        msg.includes('token')                         ||
        msg.includes('too large')                     ||
        msg.includes('exceeds')                       ||
        msg.includes('context length')
      );
      if (!isCapacityError) break;

      console.warn(`[Analyzer] Strategy "${strategy.label}" hit capacity error — trying next strategy`);
    }
  }

  // Final error — ensure it has a user-friendly message
  if (lastErr instanceof GeminiUserError) throw lastErr;
  const classified = classifyGeminiError(lastErr);
  throw new GeminiUserError(classified.userMessage, classified.type);
}
