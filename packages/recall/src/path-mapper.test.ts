import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRecallPath,
  parseRecallRecordingPath,
  recallRecordingPath,
  recallRecordingsIndexPath,
} from "./path-mapper.js";

test("maps Recall recordings to the canonical recording JSON path", () => {
  assert.equal(recallRecordingPath("rec_123"), "/recall/recordings/rec_123.json");
  assert.equal(computeRecallPath("recording", "rec_123"), "/recall/recordings/rec_123.json");
  assert.equal(computeRecallPath("transcript", "rec_123"), "/recall/recordings/rec_123.json");
  assert.equal(recallRecordingsIndexPath(), "/recall/recordings/_index.json");
});

test("round trips encoded Recall recording ids", () => {
  const path = recallRecordingPath("rec/id with spaces");
  assert.deepEqual(parseRecallRecordingPath(path), { recordingId: "rec/id with spaces" });
});
