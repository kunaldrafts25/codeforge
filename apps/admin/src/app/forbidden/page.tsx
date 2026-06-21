'use client'

import Link from 'next/link'

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">403 — Forbidden</h1>
        <p className="text-muted-foreground max-w-md">
          Your account does not have the required role to access the admin app. Contact a
          super-admin if you believe this is wrong.
        </p>
        <Link
          href="/login"
          className="inline-block px-4 py-2 rounded-md bg-primary text-primary-foreground"
        >
          Sign in with a different account
        </Link>
      </div>
    </div>
  )
}
