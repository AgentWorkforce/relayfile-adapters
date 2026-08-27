import type { RampIndexRow } from './types.js';

export function summarizeRampIndexRow(row: RampIndexRow): string {
  return `${row.title} (${row.id})`;
}
