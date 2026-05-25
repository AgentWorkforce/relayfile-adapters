export const FATHOM_PROVIDER = 'fathom';
export const FATHOM_PATH_ROOT = '/fathom';

export interface FathomMeetingRecord {
  id: string;
  recording_id?: number;
  meeting_title?: string | null;
  title?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface FathomRecordingSummaryRecord {
  id: string;
  recording_id?: number;
  summary?: Record<string, unknown> | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface FathomRecordingTranscriptRecord {
  id: string;
  recording_id?: number;
  transcript?: unknown[];
  created_at?: string;
  [key: string]: unknown;
}

export interface FathomTeamRecord {
  id: string;
  name?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface FathomTeamMemberRecord {
  id: string;
  email?: string;
  name?: string;
  created_at?: string;
  team_name?: string;
  [key: string]: unknown;
}
