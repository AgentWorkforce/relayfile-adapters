export const HUBSPOT_OBJECT_TYPES = ['contact', 'company', 'deal', 'ticket'] as const;
export const HUBSPOT_WEBHOOK_ACTIONS = [
  'created',
  'deleted',
  'propertyChange',
  'merged',
  'associationChange',
] as const;

export type HubSpotObjectType = (typeof HUBSPOT_OBJECT_TYPES)[number];
export type HubSpotWebhookAction = (typeof HUBSPOT_WEBHOOK_ACTIONS)[number] | string;

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type HubSpotProperties = Record<string, string | number | boolean | null | undefined>;

export interface HubSpotAdapterConfig {
  apiBaseUrl?: string;
  appName?: string;
  clientSecret?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  portalId?: number | string;
}

export interface HubSpotAssociationReference {
  id: string;
  type?: string;
}

export interface HubSpotObjectBase {
  id: string;
  archived?: boolean;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  properties?: HubSpotProperties;
  associations?: Record<string, HubSpotAssociationReference[]>;
}

export interface HubSpotContact extends HubSpotObjectBase {
  properties?: HubSpotProperties & {
    company?: string | null;
    createdate?: string | null;
    email?: string | null;
    firstname?: string | null;
    hs_object_id?: string | null;
    jobtitle?: string | null;
    lastmodifieddate?: string | null;
    lastname?: string | null;
    lifecyclestage?: string | null;
    phone?: string | null;
    website?: string | null;
  };
}

export interface HubSpotCompany extends HubSpotObjectBase {
  properties?: HubSpotProperties & {
    city?: string | null;
    country?: string | null;
    createdate?: string | null;
    domain?: string | null;
    hs_object_id?: string | null;
    industry?: string | null;
    lifecyclestage?: string | null;
    name?: string | null;
    numberofemployees?: string | number | null;
    phone?: string | null;
    state?: string | null;
    website?: string | null;
  };
}

export interface HubSpotDeal extends HubSpotObjectBase {
  properties?: HubSpotProperties & {
    amount?: string | number | null;
    closedate?: string | null;
    createdate?: string | null;
    dealname?: string | null;
    dealstage?: string | null;
    hs_object_id?: string | null;
    hs_priority?: string | null;
    hubspot_owner_id?: string | null;
    lastmodifieddate?: string | null;
    pipeline?: string | null;
  };
}

export interface HubSpotTicket extends HubSpotObjectBase {
  properties?: HubSpotProperties & {
    content?: string | null;
    createdate?: string | null;
    hs_object_id?: string | null;
    hs_pipeline?: string | null;
    hs_pipeline_stage?: string | null;
    hs_ticket_category?: string | null;
    hs_ticket_priority?: string | null;
    hubspot_owner_id?: string | null;
    lastmodifieddate?: string | null;
    subject?: string | null;
  };
}

export type HubSpotCrmObject = HubSpotCompany | HubSpotContact | HubSpotDeal | HubSpotTicket;

export interface HubSpotWebhookPayload {
  appId?: number;
  attemptNumber?: number;
  changeFlag?: string;
  changeSource?: string;
  eventId?: number;
  eventType?: string;
  occurredAt?: number;
  objectId: number | string;
  portalId?: number;
  propertyName?: string;
  propertyValue?: string | number | boolean | null;
  subscriptionId?: number;
  subscriptionType: string;
  sourceId?: string;
}

export type HubSpotWebhookEnvelope = HubSpotWebhookPayload | HubSpotWebhookPayload[];

export interface HubSpotReadRequest {
  action: 'get_company' | 'get_contact' | 'get_deal' | 'get_ticket' | 'list_companies' | 'list_contacts' | 'list_deals' | 'list_tickets';
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export interface HubSpotWritebackRequest {
  action:
    | 'associate_company'
    | 'associate_contact'
    | 'associate_deal'
    | 'associate_ticket'
    | 'create_company'
    | 'create_contact'
    | 'create_deal'
    | 'create_ticket'
    | 'update_company'
    | 'update_contact'
    | 'update_deal'
    | 'update_ticket';
  body?: Record<string, unknown>;
  endpoint: string;
  method: 'PATCH' | 'POST' | 'PUT';
}
