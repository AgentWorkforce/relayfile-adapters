import { modelBucket, safeNormalize } from "@relayfile/adapter-core/sync-bucketing";
import { normalizeNangoShortcutModel } from "./path-mapper.js";

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoShortcutModel),
  buckets: {
    story: "stories",
    epic: "epics",
  },
});
