// Stub interface for @codeforge/proctor-sdk (owner: Agent A5, Brief A5).
// Consumer apps (aptitude runner, contest runner, problem editor) program against
// this surface so they can integrate before A5 lands the real implementation.

export type ProctorLevel = 'off' | 'light' | 'strict' | 'high_stakes'
export type ProctorSurface = 'aptitude' | 'arena' | 'contest'

export interface ProctorStartOptions {
  surface: ProctorSurface
  sessionId: string
  level: ProctorLevel
  policyUrl?: string
  onWarning?: (warning: ProctorWarning) => void
}

export interface ProctorWarning {
  code: string
  message: string
  count: number
  threshold: number
}

export interface ProctorHandle {
  stop(): Promise<void>
  flush(): Promise<void>
  isActive(): boolean
  level: ProctorLevel
  sessionId: string
}

// Stub implementation. A5 will replace this. We keep the no-op so consumer
// code can call it unconditionally during development and CI.
export const proctorSdk = {
  start(options: ProctorStartOptions): ProctorHandle {
    if (typeof window === 'undefined') {
      return makeNoopHandle(options)
    }
    if (options.level === 'off') {
      return makeNoopHandle(options)
    }
    // Stub: only wire the bare minimum — visibility log to console for dev
    // smoke-testing. The real SDK posts to /api/proctor/events.
    const visListener = (): void => {
      // eslint-disable-next-line no-console
      console.debug('[proctor-sdk:stub] visibility', document.visibilityState)
    }
    document.addEventListener('visibilitychange', visListener)
    let active = true
    return {
      level: options.level,
      sessionId: options.sessionId,
      isActive: () => active,
      async flush() {
        // no-op in stub
      },
      async stop() {
        if (!active) return
        active = false
        document.removeEventListener('visibilitychange', visListener)
      },
    }
  },
}

function makeNoopHandle(options: ProctorStartOptions): ProctorHandle {
  return {
    level: options.level,
    sessionId: options.sessionId,
    isActive: () => false,
    async flush() {},
    async stop() {},
  }
}
