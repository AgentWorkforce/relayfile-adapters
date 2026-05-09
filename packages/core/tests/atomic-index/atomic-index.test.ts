import test from "node:test";
import assert from "node:assert/strict";

import {
  AtomicIndexExhaustedError,
  isConflictError,
  upsertIndexAtomic,
  type VfsLike,
} from "../../src/atomic-index/index.js";

interface CasFile {
  content: string;
  revision: string;
}

interface CasVfsOptions {
  /**
   * If set, the next `n` write attempts to the matching path will throw a
   * synthetic `RevisionConflictError`-shaped error before any state changes.
   * This simulates a hostile concurrent writer beating us to the punch.
   */
  forceConflicts?: { path: string; remaining: number };
}

class CasVfs {
  private readonly files = new Map<string, CasFile>();
  private revisionCounter = 0;
  private readonly options: CasVfsOptions;

  readonly conflictWrites: string[] = [];
  readonly successfulWrites: string[] = [];

  constructor(options: CasVfsOptions = {}) {
    this.options = options;
  }

  armConflicts(path: string, count: number): void {
    this.options.forceConflicts = { path, remaining: count };
  }

  readFile(path: string): { content: string; revision: string } | undefined {
    const existing = this.files.get(path);
    return existing ? { content: existing.content, revision: existing.revision } : undefined;
  }

  writeFile(
    path: string,
    content: string,
    options?: { baseRevision?: string },
  ): { revision: string } {
    if (
      this.options.forceConflicts &&
      this.options.forceConflicts.path === path &&
      this.options.forceConflicts.remaining > 0
    ) {
      this.options.forceConflicts.remaining -= 1;
      this.conflictWrites.push(path);
      throw conflictError(this.files.get(path)?.revision ?? "0", options?.baseRevision ?? "0");
    }

    const baseRevision = options?.baseRevision ?? "0";
    const existing = this.files.get(path);
    const currentRevision = existing?.revision ?? "0";

    if (currentRevision !== baseRevision) {
      this.conflictWrites.push(path);
      throw conflictError(currentRevision, baseRevision);
    }

    this.revisionCounter += 1;
    const nextRevision = `r${this.revisionCounter}`;
    this.files.set(path, { content, revision: nextRevision });
    this.successfulWrites.push(path);
    return { revision: nextRevision };
  }
}

function conflictError(currentRevision: string, expectedRevision: string): Error {
  const error = new Error(
    `RevisionConflictError: expected ${expectedRevision}, current ${currentRevision}`,
  );
  Object.assign(error, {
    name: "RevisionConflictError",
    status: 409,
    code: "revision_conflict",
    expectedRevision,
    currentRevision,
  });
  return error;
}

interface TestRow {
  id: string;
  title: string;
}

const PATH = "/example/_index.json";

const PARSE_ROWS = (content: string | undefined): TestRow[] => {
  if (!content) {
    return [];
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? (parsed as TestRow[]) : [];
  } catch {
    return [];
  }
};

const SERIALIZE_ROWS = (rows: TestRow[]): string => `${JSON.stringify(rows)}\n`;

function upsertRow(rows: TestRow[], next: TestRow): TestRow[] {
  const map = new Map<string, TestRow>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  map.set(next.id, next);
  return [...map.values()].sort((left, right) => left.id.localeCompare(right.id));
}

test("isConflictError detects RevisionConflictError by name", () => {
  const err = Object.assign(new Error("boom"), { name: "RevisionConflictError" });
  assert.equal(isConflictError(err), true);
});

test("isConflictError detects 409 by status", () => {
  assert.equal(isConflictError({ status: 409 }), true);
  assert.equal(isConflictError({ statusCode: 409 }), true);
});

test("isConflictError detects revision_conflict by code", () => {
  assert.equal(isConflictError({ code: "revision_conflict" }), true);
});

test("isConflictError returns false for unrelated errors", () => {
  assert.equal(isConflictError(new Error("disk full")), false);
  assert.equal(isConflictError({ status: 500 }), false);
  assert.equal(isConflictError(undefined), false);
  assert.equal(isConflictError(null), false);
  assert.equal(isConflictError("conflict"), false);
});

test("isConflictError does not match unrelated codes that merely contain the word 'conflict'", () => {
  // Regression: previous regex `/(revision_conflict|conflict)/i` matched
  // any code with "conflict" as a substring, causing false retries on
  // unrelated errors like merge_conflict / name_conflict.
  assert.equal(isConflictError({ code: "merge_conflict" }), false);
  assert.equal(isConflictError({ code: "name_conflict" }), false);
  assert.equal(isConflictError({ code: "permission_conflict" }), false);
  assert.equal(isConflictError({ code: "CONFLICT" }), false);
});

test("upsertIndexAtomic writes once on the happy path with no conflict", async () => {
  const vfs = new CasVfs();
  await upsertIndexAtomic<TestRow>(
    vfs as unknown as VfsLike,
    PATH,
    PARSE_ROWS,
    (rows) => upsertRow(rows, { id: "7", title: "Add login" }),
    SERIALIZE_ROWS,
    { sleep: async () => undefined },
  );

  assert.equal(vfs.successfulWrites.length, 1);
  assert.equal(vfs.conflictWrites.length, 0);
  const stored = vfs.readFile(PATH);
  assert.ok(stored, "index file should exist");
  const rows = JSON.parse(stored!.content) as TestRow[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "7");
});

test("upsertIndexAtomic retries successfully after a single conflict", async () => {
  const vfs = new CasVfs();
  // seed with a row from a "competing" writer
  vfs.writeFile(PATH, JSON.stringify([{ id: "5", title: "Existing" }]) + "\n", {
    baseRevision: "0",
  });
  vfs.armConflicts(PATH, 1);

  let invocations = 0;
  await upsertIndexAtomic<TestRow>(
    vfs as unknown as VfsLike,
    PATH,
    PARSE_ROWS,
    (rows) => {
      invocations += 1;
      return upsertRow(rows, { id: "7", title: "New" });
    },
    SERIALIZE_ROWS,
    { sleep: async () => undefined, baseDelayMs: 0 },
  );

  assert.equal(invocations, 2, "merge should run on each attempt");
  assert.equal(vfs.conflictWrites.length, 1);
  const stored = vfs.readFile(PATH);
  const rows = JSON.parse(stored!.content) as TestRow[];
  const ids = rows.map((row) => row.id).sort();
  // Both the pre-seeded "competing" row and the new row must survive.
  assert.deepEqual(ids, ["5", "7"]);
});

test("upsertIndexAtomic throws AtomicIndexExhaustedError when conflicts persist past the budget", async () => {
  const vfs = new CasVfs({
    forceConflicts: { path: PATH, remaining: 100 },
  });

  await assert.rejects(
    upsertIndexAtomic<TestRow>(
      vfs as unknown as VfsLike,
      PATH,
      PARSE_ROWS,
      (rows) => upsertRow(rows, { id: "7", title: "Stuck" }),
      SERIALIZE_ROWS,
      { maxAttempts: 3, sleep: async () => undefined, baseDelayMs: 0 },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AtomicIndexExhaustedError);
      assert.equal(error.attempts, 3);
      assert.equal(error.path, PATH);
      return true;
    },
  );

  assert.equal(vfs.successfulWrites.length, 0);
});

test("upsertIndexAtomic rethrows non-conflict errors without retrying", async () => {
  const vfs: VfsLike = {
    readFile() {
      return undefined;
    },
    writeFile() {
      const error = new Error("disk full");
      Object.assign(error, { status: 500 });
      throw error;
    },
  };

  let attempts = 0;
  await assert.rejects(
    upsertIndexAtomic<TestRow>(
      vfs,
      PATH,
      PARSE_ROWS,
      (rows) => {
        attempts += 1;
        return rows;
      },
      SERIALIZE_ROWS,
      { sleep: async () => undefined, maxAttempts: 5 },
    ),
    /disk full/,
  );
  assert.equal(attempts, 1, "non-conflict errors must not trigger retry");
});

test("upsertIndexAtomic reports existedAtWrite=true when the file already existed at the winning read", async () => {
  // Regression: callers that build an IngestResult-shaped accounting wrapper
  // around upsertIndexAtomic (e.g. github's runAtomicIndexWrite) previously
  // read existedBefore from a dedicated pre-CAS read. If a racing writer
  // created the file between that read and the eventual successful CAS
  // write, the wrapper reported filesWritten: 1 / filesUpdated: 0 even though
  // the winning attempt actually updated an existing file. The fix moves the
  // existed check inside upsertIndexAtomic where the read that produced the
  // winning baseRevision is the source of truth.
  const vfs = new CasVfs();
  vfs.writeFile(PATH, JSON.stringify([{ id: "1", title: "One" }]) + "\n");

  const { existedAtWrite } = await upsertIndexAtomic<TestRow>(
    vfs as unknown as VfsLike,
    PATH,
    PARSE_ROWS,
    (rows) => upsertRow(rows, { id: "2", title: "Two" }),
    SERIALIZE_ROWS,
    { sleep: async () => undefined, baseDelayMs: 0 },
  );

  assert.equal(existedAtWrite, true, "existedAtWrite must reflect the winning read");
});

test("upsertIndexAtomic reports existedAtWrite=false on first creation", async () => {
  const vfs = new CasVfs();

  const { existedAtWrite } = await upsertIndexAtomic<TestRow>(
    vfs as unknown as VfsLike,
    PATH,
    PARSE_ROWS,
    (rows) => upsertRow(rows, { id: "1", title: "One" }),
    SERIALIZE_ROWS,
    { sleep: async () => undefined, baseDelayMs: 0 },
  );

  assert.equal(existedAtWrite, false);
});
