export type HttpMethod =
  | "DELETE"
  | "GET"
  | "PATCH"
  | "POST"
  | "PUT";

export interface SchemaNode {
  ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  nullable?: boolean;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
  additionalProperties?: boolean | SchemaNode;
  raw?: Record<string, unknown>;
}

export interface EndpointParameter {
  name: string;
  in: string;
  required: boolean;
  schema?: SchemaNode;
}

export interface EndpointSpec {
  key: string;
  operationId: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  requestSchema?: SchemaNode;
  responseSchema?: SchemaNode;
  parameters: EndpointParameter[];
}

export interface ServiceSpec {
  title: string;
  version: string;
  sourceKind: "docs" | "openapi" | "postman" | "samples";
  sourceLocation: string;
  endpoints: EndpointSpec[];
  schemas: Record<string, SchemaNode>;
  webhookSchemas: Record<string, SchemaNode>;
  raw?: Record<string, unknown>;
}
