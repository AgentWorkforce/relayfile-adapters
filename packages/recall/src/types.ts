export const RECALL_PROVIDER = 'recall';
export const RECALL_PATH_ROOT = '/recall';

export interface RecallRecording {
  id: string;
  status?: string | null;
  title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  transcript_text?: string | null;
  transcript?: unknown;
  video_url?: string | null;
  audio_url?: string | null;
  bot_id?: string | null;
  [key: string]: unknown;
}

export interface RecallTranscriptWebhookPayload {
  id?: string | number;
  recording_id?: string | number;
  recordingId?: string | number;
  recording?: { id?: string | number } | string | number | null;
  transcript_text?: string | null;
  transcript?: unknown;
  [key: string]: unknown;
}
