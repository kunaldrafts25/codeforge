'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

function VerifyInner() {
  const queryToken = useSearchParams().get('token')
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<'pending' | 'ok' | 'err'>('pending')
  const [message, setMessage] = useState('')
  const lastToken = useRef<string | null>(null)
  const fragmentRef = useRef<string | null>(null)

  useEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (fragmentToken) fragmentRef.current = fragmentToken
    setToken(fragmentRef.current ?? queryToken)
    if (fragmentToken) window.history.replaceState(null, '', window.location.pathname)
    setReady(true)
  }, [queryToken])

  useEffect(() => {
    if (!ready) return
    if (!token) {
      setState('err')
      setMessage('Missing token')
      return
    }
    if (lastToken.current === token) return
    lastToken.current = token
    void api
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err: { response?: { data?: { error?: { message?: string } } } }) => {
        setState('err')
        setMessage(err.response?.data?.error?.message ?? 'Verification failed')
      })
  }, [token, ready])

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
          <Link href="/auth/check-inbox" className="inline-block mt-4 text-primary hover:underline">
            Request a new link
          </Link>
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
