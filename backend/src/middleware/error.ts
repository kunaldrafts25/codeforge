import type { Request, Response, NextFunction } from 'express'

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(err.stack)

  if (res.headersSent) {
    return next(err)
  }

  res.status(500).json({
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
  })
}
