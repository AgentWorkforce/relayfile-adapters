import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ChangeDetectionResult,
  DocsSyncConfig,
  DocsSyncTrigger,
} from "./types.js";

interface StateRecord {
  lastValue?: string;
}

type StateFile = Record<string, StateRecord>;

export interface ChangeDetectorCheckInput extends DocsSyncConfig {
  url: string;
  githubToken?: string;
}

export class ChangeDetector {
  private readonly fetchImpl: typeof fetch;
  private readonly stateFile: string;

  constructor(options?: { fetchImpl?: typeof fetch; stateFile?: string }) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.stateFile = options?.stateFile ?? ".adapter-core-state.json";
  }

  async check(input: ChangeDetectorCheckInput): Promise<ChangeDetectionResult> {
    const stateKey = this.getStateKey(input);
    const state = await this.loadState(input.stateFile);
    const previous = state[stateKey]?.lastValue;
    const current = await this.readCurrentValue(input);

    return {
      changed: previous === undefined ? true : previous !== current,
      reason:
        previous === undefined
          ? `No baseline recorded for ${input.trigger}`
          : previous !== current
            ? `${input.trigger} changed`
            : `${input.trigger} unchanged`,
      previousHash: previous,
      currentHash: current,
      stateKey,
    };
  }

  async record(
    input: ChangeDetectorCheckInput,
    result: Pick<ChangeDetectionResult, "currentHash" | "stateKey">
  ): Promise<void> {
    const state = await this.loadState(input.stateFile);
    state[result.stateKey] = { lastValue: result.currentHash };
    const file = resolve(input.stateFile ?? this.stateFile);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
  }

  private getStateKey(input: ChangeDetectorCheckInput): string {
    if (input.trigger === "changelog-rss") {
      return `${input.trigger}:${input.feedUrl ?? input.url}`;
    }
    if (input.trigger === "github-release") {
      return `${input.trigger}:${input.repo ?? input.url}`;
    }
    return `${input.trigger}:${input.url}`;
  }

  private async readCurrentValue(input: ChangeDetectorCheckInput): Promise<string> {
    if (input.trigger === "changelog-rss") {
      return this.readFeedValue(input.feedUrl ?? input.url);
    }
    if (input.trigger === "github-release") {
      if (!input.repo) {
        throw new Error("github-release trigger requires sync.repo");
      }
      return this.readGitHubReleaseValue(input.repo, input.githubToken);
    }
    return this.readContentHash(input.url);
  }

  private async readContentHash(url: string): Promise<string> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`
      );
    }
    return createHash("sha256")
      .update(await response.text())
      .digest("hex");
  }

  private async readFeedValue(feedUrl: string): Promise<string> {
    const response = await this.fetchImpl(feedUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${feedUrl}: ${response.status} ${response.statusText}`
      );
    }

    const xml = await response.text();
    const entries = Array.from(
      xml.matchAll(/<(entry|item)\b[\s\S]*?<\/\1>/gi),
      (match) => match[0]
    );
    const first = entries[0] ?? xml;
    return (
      first.match(/<(guid|id)>([\s\S]*?)<\/\1>/i)?.[2]?.trim() ??
      first.match(/<(updated|pubDate)>([\s\S]*?)<\/\1>/i)?.[2]?.trim() ??
      first.match(/<link[^>]*href="([^"]+)"/i)?.[1]?.trim() ??
      createHash("sha256").update(first).digest("hex")
    );
  }

  private async readGitHubReleaseValue(
    repo: string,
    token?: string
  ): Promise<string> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
    };
    if (token || process.env.GITHUB_TOKEN) {
      headers.authorization = `Bearer ${token ?? process.env.GITHUB_TOKEN}`;
    }

    const releaseResponse = await this.fetchImpl(
      `https://api.github.com/repos/${repo}/releases/latest`,
      { headers }
    );
    if (releaseResponse.ok) {
      const release = (await releaseResponse.json()) as Record<string, unknown>;
      const value =
        (typeof release.tag_name === "string" && release.tag_name) ||
        (typeof release.name === "string" && release.name);
      if (value) {
        return value;
      }
    }

    const tagsResponse = await this.fetchImpl(
      `https://api.github.com/repos/${repo}/tags?per_page=1`,
      { headers }
    );
    if (!tagsResponse.ok) {
      throw new Error(
        `Failed to fetch GitHub release info for ${repo}: ${tagsResponse.status} ${tagsResponse.statusText}`
      );
    }
    const tags = (await tagsResponse.json()) as Array<Record<string, unknown>>;
    const first = tags[0];
    const name = first && typeof first.name === "string" ? first.name : undefined;
    if (!name) {
      throw new Error(`No GitHub releases or tags found for ${repo}`);
    }
    return name;
  }

  private async loadState(stateFile?: string): Promise<StateFile> {
    const file = resolve(stateFile ?? this.stateFile);
    try {
      const text = await readFile(file, "utf8");
      return JSON.parse(text) as StateFile;
    } catch {
      return {};
    }
  }
}

export function defaultSyncConfig(
  url: string,
  sync?: DocsSyncConfig
): ChangeDetectorCheckInput {
  return {
    trigger: (sync?.trigger ?? "content-hash") as DocsSyncTrigger,
    feedUrl: sync?.feedUrl,
    repo: sync?.repo,
    stateFile: sync?.stateFile,
    url,
  };
}
