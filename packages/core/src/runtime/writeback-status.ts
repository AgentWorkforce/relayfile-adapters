export type WritebackOperation = "patch" | "create" | "delete";

export type WritebackOutcome =
  | "ok"
  | "validation_failed"
  | "readonly_rejected"
  | "adapter_error";

export type WritebackStatusState = "accepted" | "rejected";

export type WritebackStatusCode =
  | "OK"
  | "VALIDATION_FAILED"
  | "READ_ONLY_FIELD"
  | "ADAPTER_ERROR";

export interface WritebackStatusEntry {
  path: string;
  op: WritebackOperation;
  status?: WritebackStatusState;
  code?: WritebackStatusCode;
  outcome: WritebackOutcome;
  error?: string;
  field?: string;
  timestamp: string;
}

export interface WritebackStatusFilter {
  path?: string;
  op?: WritebackOperation;
  status?: WritebackStatusState;
  code?: WritebackStatusCode;
  outcome?: WritebackOutcome;
  field?: string;
}

const writebackStatusEntries: WritebackStatusEntry[] = [];

export function recordWritebackStatus(entry: WritebackStatusEntry): void {
  writebackStatusEntries.push({ ...entry });
}

export function listWritebackStatus(
  filter: WritebackStatusFilter = {}
): WritebackStatusEntry[] {
  return writebackStatusEntries
    .filter((entry) => {
      if (filter.path !== undefined && entry.path !== filter.path) {
        return false;
      }
      if (filter.op !== undefined && entry.op !== filter.op) {
        return false;
      }
      if (filter.status !== undefined && entry.status !== filter.status) {
        return false;
      }
      if (filter.code !== undefined && entry.code !== filter.code) {
        return false;
      }
      if (filter.outcome !== undefined && entry.outcome !== filter.outcome) {
        return false;
      }
      if (filter.field !== undefined && entry.field !== filter.field) {
        return false;
      }
      return true;
    })
    .map((entry) => ({ ...entry }));
}

export function clearWritebackStatus(): void {
  writebackStatusEntries.length = 0;
}
