/**
 * Stable public error codes for the API.
 * Internal errors are logged with full details; only codes and generic messages reach clients.
 */

export const ErrorCode = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',

  // Projects
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_SLUG_TAKEN: 'PROJECT_SLUG_TAKEN',
  PROJECT_LIMIT_REACHED: 'PROJECT_LIMIT_REACHED',

  // AI
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_PROVIDER_TIMEOUT: 'AI_PROVIDER_TIMEOUT',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',

  // Build/Deploy
  BUILD_FAILED: 'BUILD_FAILED',
  BUILD_TIMEOUT: 'BUILD_TIMEOUT',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
  DEPLOY_NOT_FOUND: 'DEPLOY_NOT_FOUND',

  // Database
  QUERY_REJECTED: 'QUERY_REJECTED',
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  SCHEMA_ERROR: 'SCHEMA_ERROR',

  // Source control
  SNAPSHOT_CONFLICT: 'SNAPSHOT_CONFLICT',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // Billing
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  ENTITLEMENT_EXCEEDED: 'ENTITLEMENT_EXCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  // GitHub
  GITHUB_NOT_CONNECTED: 'GITHUB_NOT_CONNECTED',
  GITHUB_SYNC_CONFLICT: 'GITHUB_SYNC_CONFLICT',
  GITHUB_RATE_LIMITED: 'GITHUB_RATE_LIMITED',

  // Generic
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // tRPC standard codes (passed through from TRPCError)
  BAD_REQUEST: 'BAD_REQUEST',
  TIMEOUT: 'TIMEOUT',
  CONFLICT: 'CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  METHOD_NOT_SUPPORTED: 'METHOD_NOT_SUPPORTED',
  CLIENT_CLOSED_REQUEST: 'CLIENT_CLOSED_REQUEST',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Map internal errors to stable public codes.
 */
export function mapErrorCode(error: unknown): ErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: string }).code;

    // Remap standard tRPC codes to stable public codes
    if (code === 'TOO_MANY_REQUESTS') return ErrorCode.RATE_LIMITED;
    if (code === 'TIMEOUT') return ErrorCode.AI_PROVIDER_TIMEOUT;
    if (code === 'INTERNAL_SERVER_ERROR') return ErrorCode.INTERNAL_ERROR;
    if (code === 'PARSE_ERROR') return ErrorCode.VALIDATION_ERROR;

    // Direct pass-through for codes already in the map
    if (code in ErrorCode) {
      return ErrorCode[code as keyof typeof ErrorCode];
    }
  }
  return ErrorCode.INTERNAL_ERROR;
}

/**
 * Generic user-facing messages for each error category.
 * Never includes internal details.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCode.UNAUTHORIZED]: 'You must be signed in to perform this action.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.INVALID_CREDENTIALS]: 'Invalid email or password.',
  [ErrorCode.EMAIL_NOT_VERIFIED]: 'Please verify your email address.',
  [ErrorCode.ACCOUNT_LOCKED]: 'Too many failed attempts. Please try again later.',
  [ErrorCode.RATE_LIMITED]: 'Too many requests. Please try again later.',
  [ErrorCode.PROJECT_NOT_FOUND]: 'Project not found.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]: 'The AI provider is temporarily unavailable.',
  [ErrorCode.BUILD_FAILED]: 'The build failed. Check the build logs for details.',
  [ErrorCode.QUERY_REJECTED]: 'The query was rejected by the security policy.',
  [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred. Please try again.',
  [ErrorCode.BAD_REQUEST]: 'The request was invalid.',
  [ErrorCode.TIMEOUT]: 'The request timed out.',
  [ErrorCode.CONFLICT]: 'The request conflicts with the current state.',
  [ErrorCode.PRECONDITION_FAILED]: 'A precondition for this request was not met.',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'The request payload was too large.',
  [ErrorCode.METHOD_NOT_SUPPORTED]: 'This method is not supported.',
  [ErrorCode.CLIENT_CLOSED_REQUEST]: 'The client closed the connection.',
  [ErrorCode.PARSE_ERROR]: 'The request could not be parsed.',
};
