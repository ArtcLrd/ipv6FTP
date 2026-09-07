import axios from 'axios';
import { AppError, normalizeError, getApiErrorMessage, ERROR_COPY } from '../appErrors';

describe('AppError normalization', () => {
  it('should return the same AppError if passed directly', () => {
    const original = new AppError('test error', 'unexpected', 'TEST_CODE');
    const normalized = normalizeError(original);
    expect(normalized).toBe(original);
    expect(normalized.message).toBe('test error');
    expect(normalized.category).toBe('unexpected');
    expect(normalized.code).toBe('TEST_CODE');
  });

  it('should handle timeout Axios errors', () => {
    const mockAxiosError = {
      isAxiosError: true,
      message: 'timeout of 5000ms exceeded',
      code: 'ECONNABORTED',
      name: 'AxiosError',
      config: {},
    };

    // Spy on axios.isAxiosError to return true
    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('network');
    expect(normalized.code).toBe('TIMEOUT');
    expect(normalized.message).toBe(ERROR_COPY.NETWORK_TIMEOUT);
    expect(normalized.originalError).toBe(mockAxiosError);

    isAxiosErrorSpy.mockRestore();
  });

  it('should handle offline Axios errors where response is undefined', () => {
    const mockAxiosError = {
      isAxiosError: true,
      message: 'Network Error',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('network');
    expect(normalized.code).toBe('OFFLINE');
    expect(normalized.message).toBe(ERROR_COPY.NETWORK_OFFLINE);

    isAxiosErrorSpy.mockRestore();
  });

  it('should handle Axios errors with HTML error responses', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 502,
        data: '<html><body>Bad Gateway</body></html>',
        statusText: 'Bad Gateway',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 502',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('server');
    expect(normalized.code).toBe('SERVER_502_HTML');
    expect(normalized.message).toBe(ERROR_COPY.SERVER_ERROR);

    isAxiosErrorSpy.mockRestore();
  });

  it('should extract error message from data object containing a message field', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: 'Invalid username format' },
        statusText: 'Bad Request',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 400',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('validation');
    expect(normalized.code).toBe('BAD_REQUEST');
    expect(normalized.message).toBe('Invalid username format');

    isAxiosErrorSpy.mockRestore();
  });

  it('should extract error message from data object containing an error field', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 422,
        data: { error: 'Username already taken' },
        statusText: 'Unprocessable Entity',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 422',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('validation');
    expect(normalized.code).toBe('BAD_REQUEST');
    expect(normalized.message).toBe('Username already taken');

    isAxiosErrorSpy.mockRestore();
  });

  it('should sanitize HTML from parsed message strings', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 500,
        data: { message: '<div>Internal Server Error Detail</div>' },
        statusText: 'Internal Server Error',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 500',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('server');
    expect(normalized.code).toBe('INTERNAL_SERVER_ERROR');
    expect(normalized.message).toBe(ERROR_COPY.SERVER_ERROR);

    isAxiosErrorSpy.mockRestore();
  });

  it('should handle 401 unauthorized error', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 401,
        data: { message: 'Invalid token' },
        statusText: 'Unauthorized',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 401',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('auth');
    expect(normalized.code).toBe('UNAUTHORIZED');
    expect(normalized.message).toBe('Invalid token');

    isAxiosErrorSpy.mockRestore();
  });

  it('should handle 403 forbidden error', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 403,
        data: {},
        statusText: 'Forbidden',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 403',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('auth');
    expect(normalized.code).toBe('FORBIDDEN');
    expect(normalized.message).toBe(ERROR_COPY.AUTH_UNAUTHORIZED);

    isAxiosErrorSpy.mockRestore();
  });

  it('should handle 409 conflict error', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 409,
        data: {},
        statusText: 'Conflict',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 409',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('validation');
    expect(normalized.code).toBe('CONFLICT');
    expect(normalized.message).toBe(ERROR_COPY.CONFLICT_ERROR);

    isAxiosErrorSpy.mockRestore();
  });

  it('should handle 5xx server errors without detail', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 503,
        data: 'Service Unavailable',
        statusText: 'Service Unavailable',
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 503',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('server');
    expect(normalized.code).toBe('INTERNAL_SERVER_ERROR');
    expect(normalized.message).toBe('Service Unavailable');

    isAxiosErrorSpy.mockRestore();
  });

  it('should fall back for general Axios error', () => {
    const mockAxiosError = {
      isAxiosError: true,
      response: {
        status: 418,
        data: "I'm a teapot",
        statusText: "I'm a teapot",
        headers: {},
        config: {},
      },
      message: 'Request failed with status code 418',
      name: 'AxiosError',
      config: {},
    };

    const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const normalized = normalizeError(mockAxiosError);
    expect(normalized.category).toBe('unexpected');
    expect(normalized.code).toBe('API_ERROR_418');
    expect(normalized.message).toBe("I'm a teapot");

    isAxiosErrorSpy.mockRestore();
  });

  it('should handle standard JS Errors', () => {
    const jsError = new TypeError('Cannot read property undefined');
    const normalized = normalizeError(jsError);
    expect(normalized.category).toBe('unexpected');
    expect(normalized.code).toBe('JS_ERROR');
    expect(normalized.message).toBe('Cannot read property undefined');
  });

  it('should handle unknown/primitive throws', () => {
    const normalized = normalizeError('Some weird thrown string');
    expect(normalized.category).toBe('unexpected');
    expect(normalized.code).toBe('UNKNOWN_ERROR');
    expect(normalized.message).toBe(ERROR_COPY.UNEXPECTED);
  });
});

describe('getApiErrorMessage helper', () => {
  it('should return normalized error message', () => {
    const jsError = new Error('custom js error');
    expect(getApiErrorMessage(jsError, 'fallback message')).toBe('custom js error');
  });

  it('should return fallback message if normalization yields unexpected category and default copy', () => {
    const normalized = getApiErrorMessage('unknown string error', 'fallback message');
    expect(normalized).toBe('fallback message');
  });
});
