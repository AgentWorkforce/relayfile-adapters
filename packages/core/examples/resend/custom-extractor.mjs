import http from "node:http";

const port = Number(process.env.PORT ?? "8787");

const introPath = "/docs/api-reference/introduction";
const endpointData = {
  "/docs/api-reference/emails/send-email": {
    endpoints: [
      {
        method: "POST",
        path: "/emails",
        summary: "Send an email",
        description: "Trigger a single email through the Resend API.",
        parameters: [],
        requestShape: {
          from: "Acme <onboarding@resend.dev>",
          to: ["delivered@resend.dev"],
          subject: "Hello from Resend",
          html: "<strong>It works.</strong>",
        },
        responseShape: {
          id: "email_123",
        },
      },
    ],
  },
  "/docs/api-reference/emails/retrieve-email": {
    endpoints: [
      {
        method: "GET",
        path: "/emails/{email_id}",
        summary: "Retrieve an email",
        description: "Retrieve a single email by ID.",
        parameters: [
          {
            name: "email_id",
            in: "path",
            type: "string",
            required: true,
            description: "The Resend email identifier.",
          },
        ],
        responseShape: {
          id: "email_123",
          from: "Acme <onboarding@resend.dev>",
          to: ["delivered@resend.dev"],
          subject: "Hello from Resend",
          created_at: "2024-01-01T00:00:00.000Z",
          last_event: "delivered",
        },
      },
    ],
  },
  "/docs/api-reference/emails/retrieve-email-attachment": {
    endpoints: [
      {
        method: "GET",
        path: "/emails/{email_id}/attachments/{attachment_id}",
        summary: "Retrieve an email attachment",
        description: "Retrieve a single attachment from a sent email.",
        parameters: [
          {
            name: "email_id",
            in: "path",
            type: "string",
            required: true,
            description: "The Resend email identifier.",
          },
          {
            name: "attachment_id",
            in: "path",
            type: "string",
            required: true,
            description: "The Resend attachment identifier.",
          },
        ],
        responseShape: {
          id: "attachment_123",
          filename: "invoice.pdf",
          content_type: "application/pdf",
        },
      },
    ],
  },
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const body = await readBody(req);
  const payload = safeParse(body);
  const prompt = typeof payload?.prompt === "string" ? payload.prompt : "";
  const urls = Array.from(
    new Set(
      [...prompt.matchAll(/^URL:\s*(.+)$/gm)].map((match) => {
        try {
          return new URL(match[1].trim()).pathname;
        } catch {
          return "";
        }
      }).filter(Boolean)
    )
  );

  const result = {
    title: "Resend",
    description: "Email API extracted from Resend documentation.",
    endpoints: [],
    webhooks: [],
    auth: undefined,
    rateLimits: undefined,
    errors: undefined,
  };

  if (urls.includes(introPath)) {
    result.auth = {
      type: "bearer",
      location: "header",
      headerName: "Authorization",
    };
  }

  for (const path of urls) {
    const entry = endpointData[path];
    if (!entry) {
      continue;
    }
    for (const endpoint of entry.endpoints) {
      if (
        !result.endpoints.find(
          (item) => item.method === endpoint.method && item.path === endpoint.path
        )
      ) {
        result.endpoints.push(endpoint);
      }
    }
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ output: JSON.stringify(result) }));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`custom-extractor-listening ${port}\n`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
