// Acceptance-only rendezvous. Disabled by default and refused outside a
// freshly named loopback disposable database. The test controller kills the
// real worker; this never manufactures a verdict or alters a lease.
export async function rendezvous(stage: string, id?: string): Promise<void> {
  if (process.env.FORGE_TEST_FAULT !== stage) return
  const url = new URL(process.env.DATABASE_URL ?? '')
  if (
    process.env.SEED_DISPOSABLE_DATABASE !== '1' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !/^\/phase2_[a-f0-9]{32}$/.test(url.pathname) ||
    url.username !== 'phase2'
  )
    throw new Error('Fault rendezvous requires disposable database')
  if (id && process.env.FORGE_TEST_JOB !== id) return
  console.log(JSON.stringify({ event: 'judge.fault_rendezvous', stage, id: id ?? null }))
  await new Promise(resolve => setTimeout(resolve, 120000))
  throw new Error('Acceptance controller failed to interrupt worker')
}
