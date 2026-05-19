// Logger utility - centralizes logging and can be easily disabled in production
const isDev = process.env.NODE_ENV !== 'production'

export const logger = {
  log: (...args: unknown[]): void => {
    if (isDev && typeof window !== 'undefined') {
      // Browser environment - console is appropriate
      // eslint-disable-next-line no-console
      console.log(...args)
    }
  },
  error: (...args: unknown[]): void => {
    if (typeof window !== 'undefined') {
      // Always log errors regardless of environment
      // eslint-disable-next-line no-console
      console.error(...args)
    }
  },
  warn: (...args: unknown[]): void => {
    if (isDev && typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(...args)
    }
  },
}
