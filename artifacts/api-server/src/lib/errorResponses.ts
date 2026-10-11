export interface ErrorResponse<TMetadata = Record<string, any>> {
  code: string;
  message: string;
  correlationId: string;
  remediation: string;
  metadata?: TMetadata;
}

export function createErrorResponse<TMetadata = Record<string, any>>(params: {
  code: string;
  message: string;
  correlationId: string;
  remediation: string;
  metadata?: TMetadata;
}): ErrorResponse<TMetadata> {
  return { ...params };
}

export function createNotFoundResponse<TMetadata = Record<string, any>>(params: Omit<ErrorResponse<TMetadata>, 'code'> & {
  message: string;
  correlationId: string;
  remediation: string;
  metadata?: TMetadata;
}): ErrorResponse<TMetadata> {
  return {
    code: 'NOT_FOUND',
    ...params,
  };
}

export function createValidationErrorResponse<TMetadata = Record<string, any>>(params: Omit<ErrorResponse<TMetadata>, 'code'> & {
  message: string;
  correlationId: string;
  remediation: string;
  metadata?: TMetadata;
}): ErrorResponse<TMetadata> {
  return {
    code: 'VALIDATION_ERROR',
    ...params,
  };
}

export function createInternalErrorResponse<TMetadata = Record<string, any>>(params: Omit<ErrorResponse<TMetadata>, 'code'> & {
  message: string;
  correlationId: string;
  remediation: string;
  metadata?: TMetadata;
}): ErrorResponse<TMetadata> {
  return {
    code: 'INTERNAL_ERROR',
    ...params,
  };
}
