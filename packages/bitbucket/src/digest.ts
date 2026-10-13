import { createDigestHandler } from '@relayfile/adapter-core/digest';

export const digest = createDigestHandler({
  provider: 'bitbucket',
  identify: (path) => path.split('/').filter(Boolean).at(-1)?.replace(/\.json$/u, '') ?? path,
  actionRules: [
    { verbs: 'create|created|open|opened', pastTense: 'was created' },
    { verbs: 'merge|merged|fulfilled', pastTense: 'was merged' },
    { verbs: 'close|closed|decline|declined|rejected', pastTense: 'was closed' },
    { verbs: 'resolve|resolved', pastTense: 'was resolved' },
    { verbs: 'complete|completed', pastTense: 'was completed' },
    { verbs: 'delete|deleted', pastTense: 'was deleted' },
    { verbs: 'update|updated|push', pastTense: 'was updated' },
  ],
  alias: { mode: 'any' },
  classify: (event) => {
    const content = event.content && typeof event.content === 'object' ? event.content as Record<string, unknown> : null;
    const payload = content?.payload && typeof content.payload === 'object' ? content.payload as Record<string, unknown> : content;
    const rawState = payload?.state;
    const stateObject = rawState && typeof rawState === 'object' && !Array.isArray(rawState) ? rawState as Record<string, unknown> : null;
    const result = stateObject?.result && typeof stateObject.result === 'object' ? stateObject.result as Record<string, unknown> : null;
    const status = stateObject?.status && typeof stateObject.status === 'object' ? stateObject.status as Record<string, unknown> : null;
    const state = String(result?.name ?? status?.name ?? stateObject?.name ?? stateObject?.type ?? rawState ?? '').toLowerCase();
    if (state === 'merged') return 'was merged';
    if (state === 'declined' || state === 'closed') return 'was closed';
    if (state === 'resolved') return 'was resolved';
    if (state === 'failed' || state === 'error') return 'failed';
    if (state === 'stopped' || state === 'canceled' || state === 'cancelled') return 'was canceled';
    if (state === 'completed' || state === 'successful' || state === 'succeeded') return 'was completed';
    return null;
  },
});
