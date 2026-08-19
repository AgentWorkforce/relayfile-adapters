import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from "@relayfile/adapter-core/digest";
import {
  GMAIL_PATH_ROOTS,
  GMAIL_PROVIDER_ID,
} from "./identity.js";

export type {
  DigestBullet,
  DigestChangeEvent,
  DigestContext,
  DigestHandler,
  DigestSection,
  DigestWindow,
};

export const digest: DigestHandler = createDigestHandler({
  provider: GMAIL_PROVIDER_ID,
  pathPrefixes: GMAIL_PATH_ROOTS,
  identify: (canonicalPath) => gmailIdentifier(canonicalPath),
  alias: { segments: [] },
  classify: (event) => pastTense(event),
});

function gmailIdentifier(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const segment = segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, '');
  const separatorIndex = basename.lastIndexOf('__');
  const id = separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;

  if (path.includes('/threads/')) return `thread ${id}`;
  if (path.includes('/drafts/')) return `draft ${id}`;
  if (path.includes('/watches/')) return `watch ${id}`;
  return id;
}

const ACTION_VERB_PATTERN_1 = actionVerbRegex('create|created|add|added|write|written|receive|received');
const ACTION_VERB_PATTERN_2 = actionVerbRegex('send|sent');
const ACTION_VERB_PATTERN_3 = actionVerbRegex('delete|deleted|remove|removed');

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? '').toLowerCase();
  if (hasActionVerb(action, ACTION_VERB_PATTERN_1)) {
    return 'was created';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_2)) {
    return 'was sent';
  }
  if (hasActionVerb(action, ACTION_VERB_PATTERN_3)) {
    return 'was deleted';
  }
  return 'was updated';
}

function actionVerbRegex(verbs: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${verbs})([^a-z0-9]|$)`, 'u');
}

function hasActionVerb(action: string, pattern: RegExp): boolean {
  return pattern.test(action);
}
