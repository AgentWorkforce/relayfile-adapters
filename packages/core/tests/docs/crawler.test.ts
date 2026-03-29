import assert from "node:assert/strict";
import test from "node:test";
import { DocsCrawler } from "../../src/docs/crawler.js";

test("DocsCrawler extracts main content and follows next links", async () => {
  const responses = new Map<string, string>([
    ["https://docs.example.com/robots.txt", "User-agent: *\nAllow: /\n"],
    [
      "https://docs.example.com/api",
      `
      <html>
        <head><title>Intro</title></head>
        <body>
          <nav>ignore me</nav>
          <main>
            <h1>Widgets API</h1>
            <p>List widgets.</p>
            <a href="#overview">Overview</a>
            <a href="/api/page-2" rel="next">Next</a>
          </main>
        </body>
      </html>
      `,
    ],
    [
      "https://docs.example.com/api/page-2",
      `
      <html>
        <body>
          <main>
            <h2>Create Widget</h2>
            <pre><code>POST /widgets</code></pre>
            <a href="/api/page-2#request">Request</a>
          </main>
        </body>
      </html>
      `,
    ],
  ]);

  const crawler = new DocsCrawler({
    url: "https://docs.example.com/api",
    crawlPaths: ["/api"],
    rateLimitMs: 0,
    fetchImpl: async (input) => {
      const body = responses.get(String(input));
      assert.ok(body !== undefined, `Unexpected fetch: ${String(input)}`);
      return new Response(body, { status: 200 });
    },
  });

  const pages = await crawler.crawl();
  assert.equal(pages.length, 2);
  assert.match(pages[0]?.content ?? "", /Widgets API/);
  assert.doesNotMatch(pages[0]?.content ?? "", /ignore me/);
  assert.match(pages[1]?.content ?? "", /POST \/widgets/);
});
