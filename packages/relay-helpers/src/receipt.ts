import type { WritebackResult } from '@relayfile/adapter-core/vfs-client';

/**
 * Normalize the writeback receipt into the `{ id, url }` shape the old typed
 * clients returned. Falls back to the draft path when the worker hasn't
 * written a receipt yet (fire-and-forget / timeout).
 */
export function created(result: WritebackResult): { id: string; url: string } {
  return {
    id: result.receipt?.created ?? result.receipt?.id ?? result.path,
    url: result.receipt?.url ?? result.path
  };
}
