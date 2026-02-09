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

// Settings / API Key
export async function checkApiKeyStatus(): Promise<{ configured: boolean; source: string }> {
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

// Meetings
export async function listMeetings(params?: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}) {
  const q = new URLSearchParams();
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
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
    body: formData, // Don't set Content-Type for multipart
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
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
