import { literalModelNormalizer, modelBucket } from '@relayfile/adapter-core/sync-bucketing';

export const syncRecordBucketing = modelBucket({
  normalizeModel: literalModelNormalizer({
    FathomMeeting: 'meeting',
    meeting: 'meeting',
    FathomRecordingSummary: 'recording-summary',
    RecordingSummary: 'recording-summary',
    'recording-summary': 'recording-summary',
    FathomRecordingTranscript: 'recording-transcript',
    RecordingTranscript: 'recording-transcript',
    'recording-transcript': 'recording-transcript',
    FathomTeam: 'team',
    team: 'team',
    FathomTeamMember: 'team-member',
    TeamMember: 'team-member',
    'team-member': 'team-member',
  }),
  buckets: {
    meeting: 'meetings',
    'recording-summary': 'recordingSummaries',
    'recording-transcript': 'recordingTranscripts',
    team: 'teams',
    'team-member': 'teamMembers',
  },
});
