import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api'

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // cookies travel automatically
  headers: { 'Content-Type': 'application/json' },
})

// CSRF: read the non-httpOnly cf_csrf cookie set by the API and echo it as
// the X-CSRF-Token header on every state-changing request.
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match && match[1] ? decodeURIComponent(match[1]) : null
}

api.interceptors.request.use(config => {
  const method = (config.method ?? 'get').toLowerCase()
  if (['post', 'put', 'patch', 'delete'].includes(method)) {
    const csrf = readCookie('cf_csrf')
    if (csrf) {
      config.headers.set('X-CSRF-Token', csrf)
    }
  }
  return config
})

let refreshInFlight: Promise<void> | null = null

async function refreshTokens(): Promise<void> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = api
    .post('/auth/refresh')
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes('/auth/')
    ) {
      original._retry = true
      try {
        await refreshTokens()
        return api(original)
      } catch {
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)
