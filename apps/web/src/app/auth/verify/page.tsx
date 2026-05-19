'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

function VerifyInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState<'pending' | 'ok' | 'err'>('pending')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setState('err')
      setMessage('Missing token')
      return
    }
    void api
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err: { response?: { data?: { error?: { message?: string } } } }) => {
        setState('err')
        setMessage(err.response?.data?.error?.message ?? 'Verification failed')
      })
  }, [token])

  return (
    <div className="max-w-md text-center">
      {state === 'pending' && <p>Verifying…</p>}
      {state === 'ok' && (
        <>
          <h1 className="text-2xl font-bold mb-2">Email verified</h1>
          <p className="text-muted-foreground mb-4">You can now log in.</p>
          <Link href="/login" className="text-primary hover:underline">
            Go to login
          </Link>
        </>
      )}
      {state === 'err' && (
        <>
          <h1 className="text-2xl font-bold mb-2">Verification failed</h1>
          <p className="text-muted-foreground">{message}</p>
        </>
      )}
    </div>
  )
}

export default function VerifyPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <Suspense fallback={<p>Loading…</p>}>
        <VerifyInner />
      </Suspense>
    </div>
  )
}
