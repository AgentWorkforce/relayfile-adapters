import { modelBucket, safeNormalize } from "@relayfile/adapter-core/sync-bucketing";
import { normalizeNangoShortcutModel } from "./path-mapper.js";

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoShortcutModel),
  buckets: {
    category: "categories",
    "custom-field": "custom-fields",
    group: "groups",
    iteration: "iterations",
    label: "labels",
    member: "members",
    milestone: "milestones",
    project: "projects",
    story: "stories",
    epic: "epics",
    workflow: "workflows",
  },
});
