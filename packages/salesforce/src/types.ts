export const SALESFORCE_OBJECT_TYPES = [
  'Account',
  'Contact',
  'Opportunity',
  'Lead',
  'Case',
] as const;

export const SALESFORCE_WEBHOOK_ACTIONS = [
  'created',
  'deleted',
  'updated',
  'upserted',
] as const;

export type SalesforceObjectType = (typeof SALESFORCE_OBJECT_TYPES)[number];
export type SalesforceWebhookAction = (typeof SALESFORCE_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface SalesforceAdapterConfig {
  apiVersion?: 'v59.0' | string;
  appName?: string;
  connectionId?: string;
  instanceUrl?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
  webhookTimestampToleranceMs?: number;
}

export interface SalesforceQueryRequest {
  action:
    | 'get_account'
    | 'get_contact'
    | 'get_opportunity'
    | 'get_lead'
    | 'get_case'
    | 'list_accounts'
    | 'list_contacts'
    | 'list_opportunities'
    | 'list_leads'
    | 'list_cases';
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export interface SalesforceWritebackRequest {
  action:
    | 'create_account'
    | 'create_contact'
    | 'create_opportunity'
    | 'create_lead'
    | 'create_case'
    | 'update_account'
    | 'update_contact'
    | 'update_opportunity'
    | 'update_lead'
    | 'update_case'
    | 'replace_account'
    | 'replace_contact'
    | 'replace_opportunity'
    | 'replace_lead'
    | 'replace_case';
  method: 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  body: Record<string, unknown>;
}

export interface SalesforceUserReference {
  Id?: string;
  Name?: string;
  Email?: string;
}

export interface SalesforceAccount {
  Id: string;
  Name?: string;
  AccountNumber?: string | null;
  AnnualRevenue?: number | null;
  BillingCity?: string | null;
  BillingCountry?: string | null;
  BillingPostalCode?: string | null;
  BillingState?: string | null;
  BillingStreet?: string | null;
  CreatedDate?: string;
  Description?: string | null;
  Industry?: string | null;
  LastModifiedDate?: string;
  NumberOfEmployees?: number | null;
  Owner?: SalesforceUserReference | null;
  OwnerId?: string | null;
  Parent?: SalesforceAccountReference | null;
  ParentId?: string | null;
  Phone?: string | null;
  Rating?: string | null;
  ShippingCity?: string | null;
  ShippingCountry?: string | null;
  ShippingPostalCode?: string | null;
  ShippingState?: string | null;
  ShippingStreet?: string | null;
  Type?: string | null;
  Website?: string | null;
}

export interface SalesforceAccountReference {
  Id?: string;
  Name?: string;
}

export interface SalesforceContact {
  Id: string;
  Account?: SalesforceAccountReference | null;
  AccountId?: string | null;
  AssistantName?: string | null;
  Birthdate?: string | null;
  CreatedDate?: string;
  Department?: string | null;
  Description?: string | null;
  Email?: string | null;
  FirstName?: string | null;
  HomePhone?: string | null;
  LastModifiedDate?: string;
  LastName?: string;
  LeadSource?: string | null;
  MailingCity?: string | null;
  MailingCountry?: string | null;
  MailingPostalCode?: string | null;
  MailingState?: string | null;
  MailingStreet?: string | null;
  MobilePhone?: string | null;
  Name?: string;
  Owner?: SalesforceUserReference | null;
  OwnerId?: string | null;
  Phone?: string | null;
  ReportsToId?: string | null;
  Title?: string | null;
}

export interface SalesforceOpportunity {
  Id: string;
  Account?: SalesforceAccountReference | null;
  AccountId?: string | null;
  Amount?: number | null;
  CampaignId?: string | null;
  CloseDate?: string;
  CreatedDate?: string;
  Description?: string | null;
  ExpectedRevenue?: number | null;
  FiscalQuarter?: number | null;
  FiscalYear?: number | null;
  ForecastCategory?: string | null;
  IsClosed?: boolean;
  IsWon?: boolean;
  LastModifiedDate?: string;
  LeadSource?: string | null;
  Name?: string;
  NextStep?: string | null;
  Owner?: SalesforceUserReference | null;
  OwnerId?: string | null;
  Probability?: number | null;
  StageName?: string;
  Type?: string | null;
}

export interface SalesforceLead {
  Id: string;
  AnnualRevenue?: number | null;
  City?: string | null;
  Company?: string;
  ConvertedAccountId?: string | null;
  ConvertedContactId?: string | null;
  ConvertedDate?: string | null;
  ConvertedOpportunityId?: string | null;
  Country?: string | null;
  CreatedDate?: string;
  Description?: string | null;
  Email?: string | null;
  FirstName?: string | null;
  Industry?: string | null;
  IsConverted?: boolean;
  LastModifiedDate?: string;
  LastName?: string;
  LeadSource?: string | null;
  MobilePhone?: string | null;
  Name?: string;
  NumberOfEmployees?: number | null;
  Owner?: SalesforceUserReference | null;
  OwnerId?: string | null;
  Phone?: string | null;
  PostalCode?: string | null;
  Rating?: string | null;
  State?: string | null;
  Status?: string;
  Street?: string | null;
  Title?: string | null;
  Website?: string | null;
}

export interface SalesforceCase {
  Id: string;
  Account?: SalesforceAccountReference | null;
  AccountId?: string | null;
  CaseNumber?: string;
  ClosedDate?: string | null;
  Contact?: SalesforceContactReference | null;
  ContactId?: string | null;
  CreatedDate?: string;
  Description?: string | null;
  IsClosed?: boolean;
  LastModifiedDate?: string;
  Origin?: string | null;
  Owner?: SalesforceUserReference | null;
  OwnerId?: string | null;
  Priority?: string | null;
  Reason?: string | null;
  Status?: string;
  Subject?: string | null;
  SuppliedCompany?: string | null;
  SuppliedEmail?: string | null;
  SuppliedName?: string | null;
  Type?: string | null;
}

export interface SalesforceContactReference {
  Id?: string;
  Name?: string;
  Email?: string;
}

export type SalesforcePrimaryObject =
  | SalesforceAccount
  | SalesforceCase
  | SalesforceContact
  | SalesforceLead
  | SalesforceOpportunity;

export interface SalesforceWebhookBase<TData> {
  action?: SalesforceWebhookAction | string;
  createdAt?: string;
  data: TData;
  objectId?: string;
  objectType?: SalesforceObjectType | string;
  organizationId?: string;
  timestamp?: number | string;
  type?: SalesforceObjectType | string;
  webhookId?: string;
}

export type SalesforceAccountWebhookPayload = SalesforceWebhookBase<SalesforceAccount>;
export type SalesforceContactWebhookPayload = SalesforceWebhookBase<SalesforceContact>;
export type SalesforceOpportunityWebhookPayload = SalesforceWebhookBase<SalesforceOpportunity>;
export type SalesforceLeadWebhookPayload = SalesforceWebhookBase<SalesforceLead>;
export type SalesforceCaseWebhookPayload = SalesforceWebhookBase<SalesforceCase>;

export type SalesforceWebhookPayload =
  | SalesforceAccountWebhookPayload
  | SalesforceCaseWebhookPayload
  | SalesforceContactWebhookPayload
  | SalesforceLeadWebhookPayload
  | SalesforceOpportunityWebhookPayload
  | SalesforceWebhookBase<Record<string, JsonValue | undefined>>;
