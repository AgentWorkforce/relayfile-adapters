export const CLOUDFLARE_PATH_ROOT = "/cloudflare";

export const CLOUDFLARE_WEBHOOK_ALERT_TYPES = [
  "workers_alert",
  "workers_observability_alert",
  "advanced_http_alert_error",
  "http_alert_origin_error",
  "billing_usage_alert",
  "health_check_status_notification",
  "dedicated_ssl_certificate_event_type",
  "access_custom_certificate_expiration_type",
] as const;

export type CloudflareWebhookAlertType =
  (typeof CLOUDFLARE_WEBHOOK_ALERT_TYPES)[number];

export type CloudflarePathObjectType =
  | "worker-script"
  | "worker-usage"
  | "pages-project"
  | "d1-database"
  | "kv-namespace"
  | "r2-bucket"
  | "queue"
  | "tunnel"
  | "zone"
  | "dns-record"
  | "notification-webhook"
  | "notification-policy"
  | "notification-event";
