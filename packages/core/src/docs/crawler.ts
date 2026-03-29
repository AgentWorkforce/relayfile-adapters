import { load } from "cheerio";
import type { Element, ParentNode } from "domhandler";
import type { DocPage, DocsSourceConfig } from "./types.js";

export interface DocsCrawlerOptions extends DocsSourceConfig {
  fetchImpl?: typeof fetch;
}

const DEFAULT_REMOVE_SELECTORS = [
  "footer",
  "header",
  "nav",
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "aside",
  "[role='navigation']",
  ".sidebar",
  ".toc",
  ".breadcrumbs",
  ".pagination",
  ".ads",
];

export class DocsCrawler {
  private readonly fetchImpl: typeof fetch;
  private readonly maxPages: number;
  private readonly rateLimitMs: number;
  private lastRequestAt = 0;
  private robotsRules?: RobotsRules;

  constructor(private readonly options: DocsCrawlerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxPages = options.maxPages ?? 25;
    this.rateLimitMs = options.rateLimitMs ?? 1_000;
  }

  async crawl(): Promise<DocPage[]> {
    const queue = this.getSeedUrls();
    const pages: DocPage[] = [];
    const visited = new Set<string>();

    while (queue.length > 0 && pages.length < this.maxPages) {
      const currentUrl = queue.shift();
      if (!currentUrl || visited.has(currentUrl)) {
        continue;
      }
      visited.add(currentUrl);

      if (!(await this.isAllowedByRobots(currentUrl))) {
        continue;
      }

      const html = await this.fetchText(currentUrl);
      const page = this.extractPage(currentUrl, html);
      if (page.content) {
        pages.push(page);
      }

      for (const nextUrl of this.extractLinks(currentUrl, html)) {
        if (!visited.has(nextUrl) && !queue.includes(nextUrl)) {
          queue.push(nextUrl);
        }
      }
    }

    return pages;
  }

  private getSeedUrls(): string[] {
    const seeds = [this.options.url];
    for (const path of this.options.crawlPaths ?? []) {
      seeds.push(new URL(path, this.options.url).toString());
    }
    return Array.from(new Set(seeds.map((url) => normalizeUrl(url))));
  }

  private async isAllowedByRobots(url: string): Promise<boolean> {
    const rules = await this.getRobotsRules();
    if (!rules) {
      return true;
    }
    return rules.isAllowed(new URL(url).pathname);
  }

  private async getRobotsRules(): Promise<RobotsRules | undefined> {
    if (this.robotsRules !== undefined) {
      return this.robotsRules;
    }

    const robotsUrl = new URL("/robots.txt", this.options.url).toString();
    try {
      const response = await this.fetchImpl(robotsUrl);
      if (!response.ok) {
        this.robotsRules = undefined;
        return this.robotsRules;
      }
      this.robotsRules = new RobotsRules(await response.text());
      return this.robotsRules;
    } catch {
      this.robotsRules = undefined;
      return this.robotsRules;
    }
  }

  private async fetchText(url: string): Promise<string> {
    const now = Date.now();
    const delay = this.rateLimitMs - (now - this.lastRequestAt);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const response = await this.fetchImpl(url);
    this.lastRequestAt = Date.now();
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  private extractPage(url: string, html: string): DocPage {
    const $ = load(html);
    for (const selector of DEFAULT_REMOVE_SELECTORS) {
      $(selector).remove();
    }

    const root =
      this.options.selectors?.content
        ? $(this.options.selectors.content).first()
        : $("main, article, .content, .docs, .markdown-body, body").first();
    const title =
      $("title").first().text().trim() ||
      root.find("h1").first().text().trim() ||
      new URL(url).pathname;

    return {
      url,
      title,
      content: renderMarkdown($, root.length > 0 ? root : $("body").first()),
    };
  }

  private extractLinks(url: string, html: string): string[] {
    const $ = load(html);
    const links: string[] = [];
    const seen = new Set<string>();
    const paginationSelector =
      this.options.selectors?.pagination ?? "a[rel='next'], a:contains('Next')";

    const push = (href: string | undefined) => {
      if (!href) {
        return;
      }
      try {
        const resolved = new URL(href, url);
        if (!this.isInScope(resolved)) {
          return;
        }
        const value = normalizeUrl(resolved.toString());
        if (!seen.has(value)) {
          seen.add(value);
          links.push(value);
        }
      } catch {
        // Ignore malformed URLs.
      }
    };

    $(paginationSelector).each((_, element) => {
      push($(element).attr("href"));
    });

    $("a[href]").each((_, element) => {
      const text = $(element).text().trim().toLowerCase();
      const rel = ($(element).attr("rel") ?? "").toLowerCase();
      if (rel.includes("next") || text.includes("next")) {
        push($(element).attr("href"));
        return;
      }
      push($(element).attr("href"));
    });

    return links;
  }

  private isInScope(url: URL): boolean {
    const base = new URL(this.options.url);
    if (url.origin !== base.origin) {
      return false;
    }

    const allowedPaths = [base.pathname, ...(this.options.crawlPaths ?? [])]
      .map((path) => new URL(path, this.options.url).pathname)
      .filter(Boolean);

    return allowedPaths.length === 0
      ? true
      : allowedPaths.some((path) => url.pathname.startsWith(path));
  }
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

class RobotsRules {
  private readonly allow: string[] = [];
  private readonly disallow: string[] = [];

  constructor(text: string) {
    let active = false;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.split("#")[0]?.trim();
      if (!line) {
        continue;
      }
      const [directiveRaw, ...rest] = line.split(":");
      const directive = directiveRaw.trim().toLowerCase();
      const value = rest.join(":").trim();

      if (directive === "user-agent") {
        active = value === "*" || value.toLowerCase() === "adapter-core";
        continue;
      }

      if (!active) {
        continue;
      }

      if (directive === "allow") {
        this.allow.push(value);
      }
      if (directive === "disallow") {
        this.disallow.push(value);
      }
    }
  }

  isAllowed(pathname: string): boolean {
    const matchedAllow = this.matchLongest(pathname, this.allow);
    const matchedDisallow = this.matchLongest(pathname, this.disallow);
    return matchedAllow.length >= matchedDisallow.length;
  }

  private matchLongest(pathname: string, candidates: string[]): string {
    let winner = "";
    for (const candidate of candidates) {
      if (!candidate || !pathname.startsWith(candidate)) {
        continue;
      }
      if (candidate.length > winner.length) {
        winner = candidate;
      }
    }
    return winner;
  }
}

function renderMarkdown(
  $: ReturnType<typeof load>,
  root: ReturnType<typeof $>
): string {
  const blocks: string[] = [];
  root.contents().each((_, node) => {
    const rendered = renderNode($, node as ParentNode | Element).trim();
    if (rendered) {
      blocks.push(rendered);
    }
  });
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderNode($: ReturnType<typeof load>, node: ParentNode | Element): string {
  if ("data" in node && typeof node.data === "string") {
    return normalizeWhitespace(node.data ?? "");
  }

  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") {
    return "";
  }

  const name = node.name?.toLowerCase() ?? "";
  const element = $(node);

  if (name === "pre") {
    const code = normalizeWhitespace(element.text(), false);
    return code ? `\`\`\`\n${code}\n\`\`\`` : "";
  }

  if (name === "code") {
    const code = normalizeWhitespace(element.text(), false);
    return code ? `\`${code}\`` : "";
  }

  if (/^h[1-6]$/.test(name)) {
    const level = Number(name.slice(1));
    const text = renderChildren($, node).trim();
    return text ? `${"#".repeat(level)} ${text}` : "";
  }

  if (name === "li") {
    const text = renderChildren($, node).trim();
    return text ? `- ${text}` : "";
  }

  if (name === "a") {
    const text = renderChildren($, node).trim();
    const href = element.attr("href");
    return href && text ? `[${text}](${href})` : text;
  }

  if (name === "br") {
    return "\n";
  }

  if (name === "table") {
    return element
      .find("tr")
      .toArray()
      .map((row) =>
        $(row)
          .find("th, td")
          .toArray()
          .map((cell) => normalizeWhitespace($(cell).text()))
          .filter(Boolean)
          .join(" | ")
      )
      .filter(Boolean)
      .join("\n");
  }

  return renderChildren($, node);
}

function renderChildren($: ReturnType<typeof load>, node: ParentNode | Element): string {
  return (node.children ?? [])
    .map((child) => renderNode($, child as ParentNode | Element))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function normalizeWhitespace(value: string, collapse = true): string {
  return collapse
    ? value.replace(/\s+/g, " ").trim()
    : value.replace(/\r/g, "").trim();
}
