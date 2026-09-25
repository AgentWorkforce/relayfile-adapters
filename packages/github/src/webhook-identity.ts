export type GitHubRepositoryIdentity = {
  owner: string;
  repo: string;
};

type CheckRunPullRequestEntry = {
  number?: unknown;
  url?: unknown;
  html_url?: unknown;
};

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function asCheckRunPullRequestEntry(value: unknown): CheckRunPullRequestEntry | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as CheckRunPullRequestEntry)
    : null;
}

/**
 * Resolve a pull-request number from one `check_run.pull_requests[]` entry.
 *
 * GitHub normally supplies both `number` and an API URL, but webhook fixtures
 * and older delivery shapes may contain only the API or HTML URL. When a URL
 * is present, it is authoritative and must identify the expected repository;
 * malformed, foreign-repository, and non-GitHub URLs fail closed.
 */
export function githubCheckRunPullRequestNumber(
  value: unknown,
  expectedRepository: GitHubRepositoryIdentity,
): number | null {
  const entry = asCheckRunPullRequestEntry(value);
  if (!entry) return null;

  const urlValue =
    typeof entry.url === 'string'
      ? entry.url
      : typeof entry.html_url === 'string'
        ? entry.html_url
        : null;
  if (!urlValue) return positiveSafeInteger(entry.number);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    return null;
  }

  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  const isApiPath = pathParts[0]?.toLowerCase() === 'repos';
  const ownerIndex = isApiPath ? 1 : 0;
  const repoIndex = isApiPath ? 2 : 1;
  const kindIndex = isApiPath ? 3 : 2;
  const numberIndex = isApiPath ? 4 : 3;
  const expectedOrigin = isApiPath ? 'https://api.github.com' : 'https://github.com';
  const pullNumberSegment = pathParts[numberIndex];

  if (
    parsedUrl.origin.toLowerCase() !== expectedOrigin ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    pathParts.length !== numberIndex + 1 ||
    (pathParts[kindIndex]?.toLowerCase() !== 'pull' &&
      pathParts[kindIndex]?.toLowerCase() !== 'pulls') ||
    pathParts[ownerIndex]?.toLowerCase() !== expectedRepository.owner.toLowerCase() ||
    pathParts[repoIndex]?.toLowerCase() !== expectedRepository.repo.toLowerCase() ||
    !/^\d+$/.test(pullNumberSegment ?? '')
  ) {
    return null;
  }

  return positiveSafeInteger(Number(pullNumberSegment));
}
