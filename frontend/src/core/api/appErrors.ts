import axios from 'axios';

export type ErrorCategory =
  | 'validation'
  | 'auth'
  | 'network'
  | 'server'
  | 'unexpected'
  | 'fatal';

export class AppError extends Error {
  public readonly category: ErrorCategory;
  public readonly code?: string;
  public readonly originalError?: unknown;

  constructor(message: string, category: ErrorCategory, code?: string, originalError?: unknown) {
    super(message);
    this.name = 'AppError';
    this.category = category;
    this.code = code;
    this.originalError = originalError;

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

export const ERROR_COPY = {
  NETWORK_OFFLINE: 'You appear to be offline. Please check your internet connection and try again.',
  NETWORK_TIMEOUT: 'The connection timed out. Please try again later.',
  AUTH_UNAUTHORIZED: 'Session expired or unauthorized. Please sign in again.',
  SERVER_ERROR: 'Our servers are experiencing issues. Please try again shortly.',
  VALIDATION_ERROR: 'Please check your inputs and correct any highlighted errors.',
  CONFLICT_ERROR: 'This resource already exists or conflict occurred.',
  UNEXPECTED: 'An unexpected error occurred. Please try again.',
  FATAL: 'A critical system error occurred. The application must reload.',
};

/**
 * Checks if a string contains HTML tags.
 */
function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

/**
 * Normalizes any caught error into a typed AppError.
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    // Handle request timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return new AppError(ERROR_COPY.NETWORK_TIMEOUT, 'network', 'TIMEOUT', error);
    }

    // Handle offline / no connection
    if (!error.response) {
      return new AppError(ERROR_COPY.NETWORK_OFFLINE, 'network', 'OFFLINE', error);
    }

    const status = error.response.status;
    const data = error.response.data;

    // Check if the response contains HTML (usually a web server crash screen or reverse proxy error)
    if (data && typeof data === 'string' && isHtml(data)) {
      return new AppError(ERROR_COPY.SERVER_ERROR, 'server', `SERVER_${status}_HTML`, error);
    }

    // Normalize error message from JSON response
    let extractedMessage = '';
    if (data && typeof data === 'object') {
      if ('message' in data && typeof data.message === 'string') {
        extractedMessage = data.message;
      } else if ('error' in data && typeof data.error === 'string') {
        extractedMessage = data.error;
      }
    } else if (typeof data === 'string' && data.trim()) {
      extractedMessage = data.trim();
    }

    // Sanity check for HTML in the parsed message
    if (extractedMessage && isHtml(extractedMessage)) {
      extractedMessage = ERROR_COPY.SERVER_ERROR;
    }

    // Handle authentication / authorization issues
    if (status === 401 || status === 403) {
      return new AppError(
        extractedMessage || ERROR_COPY.AUTH_UNAUTHORIZED,
        'auth',
        status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
        error
      );
    }

    // Handle validation errors
    if (status === 422 || status === 400) {
      return new AppError(
        extractedMessage || ERROR_COPY.VALIDATION_ERROR,
        'validation',
        'BAD_REQUEST',
        error
      );
    }

    // Handle resource conflicts (e.g. adding contact that already exists)
    if (status === 409) {
      return new AppError(
        extractedMessage || ERROR_COPY.CONFLICT_ERROR,
        'validation',
        'CONFLICT',
        error
      );
    }

    // Handle internal server errors (5xx)
    if (status >= 500) {
      return new AppError(
        extractedMessage || ERROR_COPY.SERVER_ERROR,
        'server',
        'INTERNAL_SERVER_ERROR',
        error
      );
    }

    // General Axios error fallback
    return new AppError(
      extractedMessage || error.message || ERROR_COPY.UNEXPECTED,
      'unexpected',
      `API_ERROR_${status}`,
      error
    );
  }

  // Handle standard Javascript error
  if (error instanceof Error) {
    return new AppError(error.message, 'unexpected', 'JS_ERROR', error);
  }

  // Fallback for primitive throws
  return new AppError(ERROR_COPY.UNEXPECTED, 'unexpected', 'UNKNOWN_ERROR', error);
}

/**
 * Backwards compatibility wrapper for getApiErrorMessage.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const normalized = normalizeError(error);
  if (normalized.category === 'unexpected' && normalized.message === ERROR_COPY.UNEXPECTED) {
    return fallback;
  }
  return normalized.message;
}
