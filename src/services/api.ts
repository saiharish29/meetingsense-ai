const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Settings / API Key ────────────────────────────────────────────────────────

export async function checkApiKeyStatus(): Promise<{ configured: boolean; source: string; model: string }> {
  return request('/settings/api-key/status');
}

export async function saveApiKey(apiKey: string): Promise<{ success: boolean }> {
  return request('/settings/api-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  return request('/settings/api-key/validate', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

export async function fetchAvailableModels(keyOverride?: string): Promise<{
  models: Array<{ id: string; displayName: string; description: string; isRecommended: boolean; inputTokenLimit: number | null }>;
  currentModel: string;
}> {
  const qs = keyOverride ? `?key=${encodeURIComponent(keyOverride)}` : '';
  return request(`/settings/models${qs}`);
}

export async function saveModelPreference(model: string): Promise<{ success: boolean; model: string }> {
  return request('/settings/model', {
    method: 'POST',
    body: JSON.stringify({ model }),
  });
}

export async function getModelPreference(): Promise<{ model: string }> {
  return request('/settings/model');
}

// ── Meetings ─────────────────────────────────────────────────────────────────

export async function listMeetings(params?: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}) {
  const q = new URLSearchParams();
  if (params?.page)   q.set('page',   String(params.page));
  if (params?.limit)  q.set('limit',  String(params.limit));
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  return request<any>(`/meetings?${q.toString()}`);
}

export async function getMeeting(id: string) {
  return request<any>(`/meetings/${id}`);
}

export async function createMeeting(formData: FormData): Promise<{ id: string; status: string }> {
  const res = await fetch(`${API_BASE}/meetings`, {
    method: 'POST',
    body: formData, // Don't set Content-Type — browser sets multipart boundary automatically
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Trigger server-side Gemini analysis for a stored meeting.
 * Streams Server-Sent Events as the analysis progresses.
 *
 * @param meetingId  - UUID of the stored meeting
 * @param model      - Gemini model ID (optional — server uses saved preference if omitted)
 * @param onProgress - Called with (stage, detail?) as each event arrives
 * @returns          - Raw markdown analysis string when complete
 */
export async function analyzeWithServer(
  meetingId: string,
  model: string | null,
  onProgress?: (stage: string, detail?: string) => void,
): Promise<string> {
  // 10-minute timeout covers the ENTIRE operation (connection + streaming).
  // The AbortController signal is kept active until we are done reading the
  // body so that a hung Gemini response is properly cancelled.
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  try {
    const response = await fetch(`${API_BASE}/meetings/${meetingId}/analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: model || undefined }),
      signal:  controller.signal,
    });

    // Non-SSE errors (404, 400, etc.) before the stream opened
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Analysis failed' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    // Read the SSE stream
    const reader  = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE lines are separated by \n\n; process complete lines
      const lines  = buffer.split('\n');
      buffer       = lines.pop() ?? ''; // keep potentially incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue; // SSE comment or empty line

        // Parse JSON separately so real event errors are never swallowed
        let event: any;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue; // malformed data line — skip
        }

        if (event.done) {
          if (event.error) throw new Error(event.error);
          if (event.result) return event.result as string;
          throw new Error('Analysis stream ended without a result.');
        }

        onProgress?.(event.stage ?? '', event.detail);
      }
    }

    throw new Error('Analysis stream ended unexpectedly without a result.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function saveMeetingResult(id: string, data: {
  raw_markdown: string;
  executive_summary: string;
  metadata_json: string;
}): Promise<{ success: boolean }> {
  return request(`/meetings/${id}/result`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function updateMeetingStatus(id: string, status: string, errorMessage?: string) {
  return request(`/meetings/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, error_message: errorMessage }),
  });
}

export async function deleteMeeting(id: string): Promise<{ success: boolean }> {
  return request(`/meetings/${id}`, { method: 'DELETE' });
}

export async function getDashboardStats() {
  return request<any>('/meetings/stats/overview');
}

export async function healthCheck() {
  return request<any>('/health');
}
