/**
 * Minimal adapter class for the Docker Hub integration.
 *
 * Docker Hub sends webhook notifications for image push events. The
 * webhook normalizer (`webhook-normalizer.ts`) decodes the raw payload
 * and defaults to the `'push'` event type when no explicit event field
 * is present in the payload.
 *
 * This class exists primarily so the trigger-catalog generator can
 * discover the supported events via `supportedEvents()`.
 */
export class DockerHubAdapter {
  readonly slug = 'docker-hub';
  readonly source = 'docker-hub';

  supportedEvents(): string[] {
    // Docker Hub webhooks fire on image/tag push events.
    // The normalizer defaults eventType to 'push' when the payload
    // does not include an explicit event field.
    return ['push'];
  }
}
