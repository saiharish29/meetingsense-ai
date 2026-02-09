export interface AnalysisState {
  status: 'idle' | 'processing' | 'success' | 'error';
  error?: string;
  result?: string;
  meetingId?: string;
}

export interface Meeting {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  duration_minutes: number | null;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error_message: string | null;
  executive_summary?: string;
  input_count?: number;
  participant_count?: number;
}

export interface MeetingDetail extends Meeting {
  inputs: MeetingInput[];
  result: MeetingResult | null;
  participants: MeetingParticipant[];
}

export interface MeetingInput {
  id: number;
  meeting_id: string;
  input_type: 'text' | 'audio' | 'video' | 'image';
  text_content: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
}

export interface MeetingResult {
  id: number;
  meeting_id: string;
  raw_markdown: string;
  executive_summary: string;
  metadata_json: string;
}

export interface MeetingParticipant {
  id: number;
  meeting_id: string;
  name: string;
  role: string | null;
  image_path: string | null;
}

export interface Metadata {
  title: string;
  date: string;
  duration_minutes: string;
  participants: string[];
  decision_count: string;
  action_item_count: string;
  risk_count: string;
}

export interface PaginatedResponse<T> {
  meetings: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DashboardStats {
  total: number;
  completed: number;
  processing: number;
  totalDuration: number;
  recentMeetings: { id: string; title: string; created_at: string; status: string }[];
}
