declare module '@agent-relay/events' {
  export interface EventSummary {
    title?: string;
    status?: string;
    priority?: string;
    labels?: string[];
    actor?: { id: string; displayName?: string };
    fieldsChanged?: string[];
    tags?: string[];
  }
}
