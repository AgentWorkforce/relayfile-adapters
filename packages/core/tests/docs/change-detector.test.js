import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChangeDetector, defaultSyncConfig, } from "../../src/docs/change-detector.js";
test("ChangeDetector stores and reuses content hashes", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "adapter-core-docs-"));
    const stateFile = join(stateDir, "state.json");
    const detector = new ChangeDetector({
        stateFile,
        fetchImpl: async () => new Response("same-doc-content", { status: 200 }),
    });
    const config = defaultSyncConfig("https://docs.example.com/api", {
        trigger: "content-hash",
        stateFile,
    });
    const first = await detector.check(config);
    assert.equal(first.changed, true);
    await detector.record(config, first);
    const second = await detector.check(config);
    assert.equal(second.changed, false);
});
//# sourceMappingURL=change-detector.test.js.map