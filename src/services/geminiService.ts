import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT } from '../constants';

let cachedApiKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  
  const envKey = (process.env as any).GEMINI_API_KEY || (process.env as any).API_KEY;
  if (envKey && envKey.trim()) {
    cachedApiKey = envKey.trim();
    return cachedApiKey;
  }

  const res = await fetch('/api/settings/api-key/status');
  const data = await res.json();
  
  if (!data.configured) throw new Error('API_KEY_NOT_CONFIGURED');

  const keyRes = await fetch('/api/settings/api-key/active');
  if (keyRes.ok) {
    const keyData = await keyRes.json();
    cachedApiKey = keyData.key;
    return cachedApiKey!;
  }

  throw new Error('API_KEY_NOT_CONFIGURED');
}

export function clearApiKeyCache() { cachedApiKey = null; }
export function setApiKeyCache(key: string) { cachedApiKey = key; }

// ============================================================
// Size thresholds
// ============================================================
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024; // 15MB — safe margin under Gemini's 20MB base64 limit
const MAX_SCREENSHOTS = 40; // Cap screenshots to avoid payload bloat
const MAX_SCREENSHOT_QUALITY = 0.5; // Reduce quality for large meetings
const MAX_TIMELINE_ENTRIES = 200; // Cap timeline entries in metadata

// ============================================================
// Progress callback type
// ============================================================
export type ProgressCallback = (stage: string, detail?: string) => void;

// ============================================================
// Main analysis function — handles meetings of any length
// ============================================================
export async function analyzeMeeting(
  text: string,
  audioFile: File | null,
  participantImgs: File[] = [],
  onProgress?: ProgressCallback,
): Promise<string> {
  const apiKey = await getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const parts: any[] = [];
  const log = (stage: string, detail?: string) => {
    console.log(`[MeetingSense] ${stage}${detail ? ': ' + detail : ''}`);
    onProgress?.(stage, detail);
  };

  // ---- 1. Handle audio file ----
  if (audioFile) {
    const fileSize = audioFile.size;
    log('Preparing audio', `${(fileSize / 1024 / 1024).toFixed(1)} MB`);

    if (fileSize > INLINE_LIMIT_BYTES) {
      // LARGE FILE: Use Gemini File API (upload → reference by URI)
      log('Uploading audio to Gemini', 'File too large for inline — using File API');
      try {
        const uploaded = await ai.files.upload({
          file: audioFile,
          config: {
            mimeType: audioFile.type || 'audio/webm',
            displayName: audioFile.name,
          },
        });

        // Wait for file to be ready (ACTIVE state)
        let fileState = uploaded;
        let attempts = 0;
        while (fileState.state === 'PROCESSING' && attempts < 60) {
          await sleep(2000);
          fileState = await ai.files.get({ name: fileState.name! });
          attempts++;
          log('Waiting for upload', `Processing... (${attempts * 2}s)`);
        }

        if (fileState.state !== 'ACTIVE') {
          throw new Error(`File upload failed: state=${fileState.state}`);
        }

        parts.push({
          fileData: {
            fileUri: fileState.uri!,
            mimeType: fileState.mimeType!,
          },
        });
        log('Audio ready', `Uploaded via File API: ${fileState.uri}`);
      } catch (uploadErr: any) {
        // Fallback: try inline anyway (will fail for very large files)
        console.warn('File API upload failed, falling back to inline:', uploadErr.message);
        log('Upload fallback', 'Trying inline data...');
        const audioData = await fileToBase64(audioFile);
        parts.push({ inlineData: { mimeType: audioFile.type, data: audioData } });
      }
    } else {
      // SMALL FILE: Use inline (faster, no extra API call)
      log('Encoding audio', 'Inline base64');
      const audioData = await fileToBase64(audioFile);
      parts.push({ inlineData: { mimeType: audioFile.type, data: audioData } });
    }
  }

  // ---- 2. Handle participant images / screenshots ----
  // For long meetings, we may have 100+ screenshots — cap and reduce quality
  let imgs = [...participantImgs];
  if (imgs.length > MAX_SCREENSHOTS) {
    log('Reducing screenshots', `${imgs.length} → ${MAX_SCREENSHOTS} (sampling evenly)`);
    imgs = sampleEvenly(imgs, MAX_SCREENSHOTS);
  }

  log('Processing images', `${imgs.length} images`);
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    // For screenshots over 200KB, recompress
    if (img.size > 200 * 1024 && img.type.startsWith('image/')) {
      try {
        const compressed = await compressImage(img, MAX_SCREENSHOT_QUALITY, 1280);
        const imgData = await fileToBase64(compressed);
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: imgData } });
        continue;
      } catch (e) { /* fall through to raw */ }
    }
    const imgData = await fileToBase64(img);
    parts.push({ inlineData: { mimeType: img.type, data: imgData } });
  }

  // ---- 3. Build prompt with capped metadata ----
  let prompt = SYSTEM_PROMPT + '\n\n';
  if (text && text.trim()) {
    // Cap the metadata text to avoid oversized prompts
    let metaText = text;
    if (metaText.length > 100_000) {
      log('Trimming metadata', `${(metaText.length / 1024).toFixed(0)} KB → 100 KB`);
      metaText = trimMetadata(metaText, 100_000);
    }
    prompt += `Meeting Context / Transcript:\n\n${metaText}\n\n`;
  }
  if (audioFile) {
    prompt += 'Please analyze the provided audio/video recording above.\n';
  }
  if (imgs.length > 0) {
    prompt += `${imgs.length} screenshot/participant image(s) have been provided for speaker identification.\n`;
  }
  prompt += '\nPlease provide the full meeting analysis in the exact format specified.';

  parts.push({ text: prompt });

  // ---- 4. Estimate total payload ----
  const estimatedPayload = estimatePayloadSize(parts);
  log('Sending to Gemini', `~${(estimatedPayload / 1024 / 1024).toFixed(1)} MB payload, ${parts.length} parts`);

  // ---- 5. Call Gemini ----
  log('Analyzing', 'Waiting for Gemini response...');
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
  });

  const result = response?.text;
  if (!result) {
    throw new Error('No response generated. Please try again.');
  }

  log('Complete', `${result.length} chars generated`);
  return result;
}

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Evenly sample `count` items from an array */
function sampleEvenly<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr;
  const step = arr.length / count;
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(arr[Math.floor(i * step)]);
  }
  return result;
}

/** Compress an image file to JPEG at given quality and max dimension */
async function compressImage(file: File | Blob, quality: number, maxDim: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Compression failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Trim metadata text intelligently — keep header, trim timeline entries */
function trimMetadata(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  // Try to find the SPEAKER ACTIVITY TIMELINE section and trim it
  const timelineStart = text.indexOf('SPEAKER ACTIVITY TIMELINE');
  const timelineEnd = text.indexOf('\n\nSCREENSHOT EVIDENCE');
  
  if (timelineStart > -1 && timelineEnd > -1) {
    const before = text.slice(0, timelineStart);
    const timeline = text.slice(timelineStart, timelineEnd);
    const after = text.slice(timelineEnd);
    
    // Keep first and last N entries of timeline
    const lines = timeline.split('\n');
    const header = lines.slice(0, 3); // header lines
    const entries = lines.slice(3).filter(l => l.startsWith('- ['));
    
    if (entries.length > MAX_TIMELINE_ENTRIES) {
      const keep = MAX_TIMELINE_ENTRIES;
      const half = Math.floor(keep / 2);
      const trimmedEntries = [
        ...entries.slice(0, half),
        `- [... ${entries.length - keep} entries trimmed for brevity ...]`,
        ...entries.slice(-half),
      ];
      const trimmedTimeline = [...header, ...trimmedEntries].join('\n');
      const result = before + trimmedTimeline + after;
      if (result.length <= maxLen) return result;
    }
  }

  // Hard truncation as last resort
  return text.slice(0, maxLen) + '\n\n[... metadata truncated due to length ...]';
}

/** Rough estimate of total payload size in bytes */
function estimatePayloadSize(parts: any[]): number {
  let total = 0;
  for (const p of parts) {
    if (p.inlineData?.data) {
      total += p.inlineData.data.length; // base64 string length ≈ bytes
    } else if (p.fileData?.fileUri) {
      total += 100; // just the URI reference
    } else if (p.text) {
      total += p.text.length;
    }
  }
  return total;
}
