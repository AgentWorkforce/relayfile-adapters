export interface ValidationResult {
  isValidation: boolean;
  validationToken?: string;
}

export interface ValidationResponse {
  statusCode: 200;
  headers: Record<string, string>;
  body: string;
}

export function extractValidationToken(
  queryParams: Record<string, string | string[] | undefined>,
): ValidationResult {
  const token = queryParams.validationToken ?? queryParams.validationtoken;
  const value = Array.isArray(token) ? token[0] : token;

  if (typeof value === 'string' && value.length > 0) {
    return { isValidation: true, validationToken: value };
  }

  return { isValidation: false };
}

export function createValidationResponse(validationToken: string): ValidationResponse {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/plain',
    },
    body: validationToken,
  };
}

export function validateClientState(
  notification: { clientState?: string },
  expectedClientState?: string,
): boolean {
  if (!expectedClientState) {
    return true;
  }

  return notification.clientState === expectedClientState;
}
