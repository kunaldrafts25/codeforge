import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api'

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

let csrfToken: string | null = null
let csrfInFlight: Promise<void> | null = null

export async function ensureCsrf(): Promise<void> {
  if (csrfToken) return
  if (!csrfInFlight) {
    csrfInFlight = api
      .get<{ csrfToken: string }>('/auth/csrf')
      .then(response => {
        csrfToken = response.data.csrfToken
      })
      .finally(() => {
        csrfInFlight = null
      })
  }
  await csrfInFlight
}

api.interceptors.request.use(async config => {
  const method = (config.method ?? 'get').toLowerCase()
  if (['post', 'put', 'patch', 'delete'].includes(method)) {
    await ensureCsrf()
    config.headers.set('X-CSRF-Token', csrfToken)
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
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
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
