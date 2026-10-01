import { describe, expect, it } from 'vitest'
import {
  HttpError,
  badRequest,
  buildErrorBody,
  conflict,
  forbidden,
  isHttpError,
  notFound,
  tooMany,
  unauthorized,
} from './errors.js'

const reqStub = { id: 'req-1' } as unknown as Parameters<typeof buildErrorBody>[0]

describe('errors', () => {
  it('factory functions build correctly typed HttpErrors', () => {
    expect(badRequest('X', 'x').statusCode).toBe(400)
    expect(unauthorized('X', 'x').statusCode).toBe(401)
    expect(forbidden('X', 'x').statusCode).toBe(403)
    expect(notFound('X', 'x').statusCode).toBe(404)
    expect(conflict('X', 'x').statusCode).toBe(409)
    expect(tooMany('X', 'x').statusCode).toBe(429)
  })

  it('isHttpError narrows correctly', () => {
    expect(isHttpError(notFound('a', 'b'))).toBe(true)
    expect(isHttpError(new Error('x'))).toBe(false)
  })

  it('builds error body with requestId', () => {
    const body = buildErrorBody(reqStub, 'CODE', 'msg')
    expect(body.error.code).toBe('CODE')
    expect(body.error.message).toBe('msg')
    expect(body.error.requestId).toBe('req-1')
  })

  it('HttpError carries optional details', () => {
    const err = new HttpError(418, 'TEA', 'I am a teapot', { tea: 'earl-grey' })
    expect(err.details).toEqual({ tea: 'earl-grey' })
  })
})
