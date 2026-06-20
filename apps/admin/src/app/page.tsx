'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RootPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/admin/quiz-review')
  }, [router])
  return null
}
