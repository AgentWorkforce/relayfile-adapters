import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createAdapterRegistry } from "./registry.js";
import { installWebhookRoutes } from "./routes.js";
import type {
  RegisteredWebhookAdapter,
  StartedWebhookServer,
  WebhookServer,
  WebhookServerOptions,
  WebhookStartOptions,
} from "./types.js";

function closeNodeServer(server: { close(callback: (error?: Error) => void): void }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function createWebhookServer(options: WebhookServerOptions): WebhookServer {
  const app = new Hono();
  const registry = createAdapterRegistry(options.adapters ?? {});
  const workspaceId = options.workspaceId ?? "default";
  const defaultPort = options.port ?? 3456;
  const defaultHostname = options.hostname ?? "0.0.0.0";

  installWebhookRoutes({
    app,
    client: options.client,
    workspaceId,
    registry,
    secrets: options.secrets ?? {},
  });

  const server: WebhookServer = {
    app,
    registry,
    register(name: string, adapter: RegisteredWebhookAdapter): WebhookServer {
      registry.register(name, adapter);
      return server;
    },
    getAdapter(name: string): RegisteredWebhookAdapter | undefined {
      return registry.get(name);
    },
    fetch(request: Request): Promise<Response> | Response {
      return app.fetch(request);
    },
    async start(startOptions: WebhookStartOptions = {}): Promise<StartedWebhookServer> {
      const hostname = startOptions.hostname ?? defaultHostname;
      const port = startOptions.port ?? defaultPort;
      const nodeServer = serve({
        fetch: app.fetch,
        hostname,
        port,
      });

      return {
        hostname,
        port,
        close(): Promise<void> {
          return closeNodeServer(nodeServer);
        },
      };
    },
  };

  return server;
}
