/**
 * Structured logger for the application.
 * In production, this can be hooked up to an external logging service.
 */

const isDev = __DEV__;

export const logger = {
  info: (message: string, ...args: any[]) => {
    if (isDev) {
      console.log(`[INFO] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    if (isDev) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    if (isDev) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  },
  debug: (message: string, ...args: any[]) => {
    if (isDev) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  },
};
