import type { FastifyReply, FastifyRequest } from 'fastify'

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details)
export const unauthorized = (code: string, message: string) => new HttpError(401, code, message)
export const forbidden = (code: string, message: string) => new HttpError(403, code, message)
export const notFound = (code: string, message: string) => new HttpError(404, code, message)
export const conflict = (code: string, message: string) => new HttpError(409, code, message)
export const tooMany = (code: string, message: string) => new HttpError(429, code, message)
export const serverError = (code: string, message: string) => new HttpError(500, code, message)

interface ErrorBody {
  error: {
    code: string
    message: string
    requestId?: string
    details?: unknown
  }
}

export function buildErrorBody(
  request: FastifyRequest,
  code: string,
  message: string,
  details?: unknown
): ErrorBody {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId: request.id,
    },
  }
  if (details !== undefined) body.error.details = details
  return body
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError
}

export async function handleError(
  err: Error & { statusCode?: number; code?: string; validation?: unknown },
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  // Zod validation errors come through fastify-type-provider-zod
  if ((err as { validation?: unknown }).validation) {
    request.log.warn({ err }, 'validation failure')
    return reply
      .status(400)
      .send(
        buildErrorBody(request, 'VALIDATION_ERROR', 'Request validation failed', err.validation)
      )
  }

  if (isHttpError(err)) {
    request.log.warn({ err, code: err.code }, 'http error')
    return reply
      .status(err.statusCode)
      .send(buildErrorBody(request, err.code, err.message, err.details))
  }

  // Rate-limit plugin uses statusCode 429
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return reply
      .status(err.statusCode)
      .send(buildErrorBody(request, err.code ?? 'CLIENT_ERROR', err.message))
  }

  request.log.error({ err }, 'unhandled error')
  return reply.status(500).send(buildErrorBody(request, 'INTERNAL_ERROR', 'Internal server error'))
}
