'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PRACTICE_LANGUAGES,
  PracticePackage,
  type PracticePackage as Package,
} from '@codeforge/shared'
import dynamic from 'next/dynamic'
import { AdminShell } from '@/components/AdminShell'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const initial: Package = {
  title: '',
  statementMd: '',
  constraints: '',
  inputFormat: '',
  outputFormat: '',
  difficultyBand: 'easy',
  tags: [],
  mode: 'STDIO',
  signature: null,
  languages: [...PRACTICE_LANGUAGES],
  limits: { timeMs: 2000, memoryKb: 262144, outputKb: 64 },
  checker: { kind: 'token', absolute: 0, relative: 0 },
  cases: [
    { input: '', output: '', sample: true, explanation: '' },
    { input: '', output: '', sample: false, explanation: '' },
  ],
  references: [{ language: 'cpp', code: '', complexity: '' }],
  starters: {},
  hints: [],
  editorial: '',
  rightsBasis: '',
}
const Markdown = dynamic(() => import('@codeforge/ui').then(m => m.Markdown), { ssr: false })
type Version = {
  id: string
  number: number
  authorId: string
  status: string
  packageHash: string
  problem: { slug: string; title?: string }
  package?: Package
  jobs?: { id: string; state: string; verdict: string | null; failureCode: string | null }[]
}
const allowed = ['PROBLEM_SETTER', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN']
const css = 'block w-full rounded border p-2 bg-background'

export default function ProblemAuthoringPage() {
  const { user } = useAuth()
  const [versions, setVersions] = useState<Version[]>([])
  const [selected, setSelected] = useState<Version | null>(null)
  const [p, setPackage] = useState<Package>(initial)
  const [slug, setSlug] = useState('')
  const [signature, setSignature] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [availability, setAvailability] = useState('Checking judge availability…')
  const [executionEnabled, setExecutionEnabled] = useState(false)
  const [validating, setValidating] = useState(false)
  const selectedId = selected?.id
  useEffect(() => {
    if (!validating || !selectedId) return
    let requests = 0
    const timer = setInterval(() => {
      if (++requests > 60) {
        setValidating(false)
        setNotice('Automatic validation updates paused. Refresh validation status.')
        return
      }
      void api
        .get<Version>(`/practice/staff/versions/${selectedId}`)
        .then(r => {
          setSelected(current => (current?.id === selectedId ? r.data : current))
          if (
            r.data.status === 'VALIDATED' ||
            r.data.jobs?.some(
              j => ['TERMINAL', 'DEAD_LETTER'].includes(j.state) && j.verdict !== 'ACCEPTED'
            )
          ) {
            setValidating(false)
          }
        })
        .catch(() => {
          setValidating(false)
          setError('Validation updates interrupted. Refresh validation status.')
        })
    }, 2000)
    return () => clearInterval(timer)
  }, [validating, selectedId])
  const canAuthor = user && ['PROBLEM_SETTER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
  const canReview = user && ['REVIEWER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
  const reload = useCallback(async () => {
    if (!user || !allowed.includes(user.role)) return
    try {
      setVersions((await api.get('/practice/staff/versions')).data.rows)
    } catch {
      setError('Could not load private problem versions.')
    }
  }, [user])
  useEffect(() => {
    void reload()
    void api
      .get('/practice/capabilities')
      .then(r => {
        setAvailability(r.data.reason)
        setExecutionEnabled(r.data.enabled === true)
      })
      .catch(() => setAvailability('Judge availability could not be checked.'))
  }, [reload])
  async function open(id: string) {
    try {
      const v = (await api.get<Version>(`/practice/staff/versions/${id}`)).data
      const packageData = PracticePackage.parse(v.package)
      setSelected(v)
      setPackage(packageData)
      setSlug(v.problem.slug)
      setSignature(packageData.signature ? JSON.stringify(packageData.signature, null, 2) : '')
      setRightsConfirmed(false)
      setError('')
      setNotice('Loaded immutable version. Saving creates a new version.')
    } catch {
      setError('This version is unavailable or you do not have access.')
    }
  }
  async function save() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const parsed = PracticePackage.safeParse({
        ...p,
        signature: p.mode === 'FUNCTIONAL' ? JSON.parse(signature) : null,
      })
      if (!parsed.success) {
        setError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
        return
      }
      const r = await api.post('/practice/staff/versions', { slug, package: parsed.data })
      await reload()
      await open(r.data.id)
      setNotice(`Version ${r.data.number} saved. Its package is immutable.`)
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Save failed. Check the signature JSON and required fields.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function action(kind: 'validate' | 'publish' | 'withdraw') {
    if (!selected) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const body =
        kind === 'publish'
          ? { rightsConfirmed, rightsBasis: p.rightsBasis, packageHash: selected.packageHash }
          : kind === 'withdraw'
            ? { reason }
            : {}
      await api.post(`/practice/staff/versions/${selected.id}/${kind}`, body)
      if (kind === 'validate') setValidating(true)
      await reload()
      await open(selected.id)
      setNotice(
        kind === 'withdraw'
          ? 'Version withdrawn. Historical records are preserved.'
          : kind === 'validate'
            ? 'Reference execution queued. Validation requires every reference to pass.'
            : 'Action completed.'
      )
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Action failed.'
      )
    } finally {
      setBusy(false)
    }
  }
  function text(
    key:
      | 'title'
      | 'statementMd'
      | 'constraints'
      | 'inputFormat'
      | 'outputFormat'
      | 'rightsBasis'
      | 'editorial',
    label: string,
    multiline = true
  ) {
    return (
      <label className="block">
        {label}
        {multiline ? (
          <textarea
            className={css}
            value={p[key]}
            onChange={e => setPackage({ ...p, [key]: e.target.value })}
          />
        ) : (
          <input
            className={css}
            value={p[key]}
            onChange={e => setPackage({ ...p, [key]: e.target.value })}
          />
        )}
      </label>
    )
  }
  return (
    <AdminShell requireMinRole="PROBLEM_SETTER" allowedRoles={allowed}>
      <main className="max-w-5xl mx-auto p-4 space-y-5">
        <h1 className="text-3xl font-bold">Coding problem authoring</h1>
        <p role="status" className="border border-amber-500 rounded p-3">
          {availability}
        </p>
        {error && (
          <p role="alert" className="text-red-600 break-words">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <section aria-label="Problem versions">
          <h2 className="text-xl font-semibold">Private versions</h2>
          <button className="border p-2" onClick={() => void reload()}>
            Refresh versions
          </button>
          <ul>
            {versions.map(v => (
              <li key={v.id}>
                <button className="underline p-2" onClick={() => void open(v.id)}>
                  {v.problem.slug} · version {v.number} · {v.status}
                </button>
              </li>
            ))}
          </ul>
          <button
            className="border p-2"
            onClick={() => {
              setSelected(null)
              setPackage(initial)
              setSlug('')
              setSignature('')
              setError('')
              setNotice('New draft.')
            }}
          >
            New problem
          </button>
        </section>
        {selected && (
          <p className="break-all">
            Version {selected.number} · {selected.status} · Package hash {selected.packageHash}
          </p>
        )}
        <form
          onSubmit={e => {
            e.preventDefault()
            void save()
          }}
          className="space-y-4"
        >
          <label className="block">
            Problem slug
            <input
              className={css}
              value={slug}
              onChange={e => setSlug(e.target.value)}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
          </label>
          {text('title', 'Title', false)}
          {text('statementMd', 'Statement Markdown')}
          <details>
            <summary>Preview sanitized statement</summary>
            <Markdown md={p.statementMd} />
          </details>
          {text('constraints', 'Constraints')}
          {text('inputFormat', 'Input format')}
          {text('outputFormat', 'Output format')}
          <label>
            Difficulty
            <select
              className={css}
              value={p.difficultyBand}
              onChange={e =>
                setPackage({ ...p, difficultyBand: e.target.value as Package['difficultyBand'] })
              }
            >
              {['easy', 'medium', 'hard', 'expert'].map(d => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Tags (comma separated)
            <input
              className={css}
              value={p.tags.join(', ')}
              onChange={e =>
                setPackage({
                  ...p,
                  tags: e.target.value
                    .split(',')
                    .map(t => t.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <fieldset>
            <legend>Supported languages</legend>
            {PRACTICE_LANGUAGES.map(l => (
              <label className="mr-4 inline-block" key={l}>
                <input
                  type="checkbox"
                  checked={p.languages.includes(l)}
                  onChange={e =>
                    setPackage({
                      ...p,
                      languages: e.target.checked
                        ? [...p.languages, l]
                        : p.languages.filter(x => x !== l),
                    })
                  }
                />{' '}
                {l}
              </label>
            ))}
          </fieldset>
          <label>
            Execution mode
            <select
              className={css}
              value={p.mode}
              onChange={e => setPackage({ ...p, mode: e.target.value as Package['mode'] })}
            >
              <option>STDIO</option>
              <option>FUNCTIONAL</option>
            </select>
          </label>
          {p.mode === 'FUNCTIONAL' && (
            <label>
              Function signature JSON
              <textarea
                className={css}
                value={signature}
                onChange={e => setSignature(e.target.value)}
              />
              <p>
                Use name, params and returns with prim/list/matrix types. Supported primitives: int,
                long, double, bool, string. Cases use JSON parameter arrays and typed return values.
              </p>
            </label>
          )}
          <fieldset className="flex flex-wrap gap-3">
            <legend>Limits</legend>
            {(['timeMs', 'memoryKb', 'outputKb'] as const).map(k => (
              <label key={k}>
                {k}
                <input
                  type="number"
                  className={css}
                  value={p.limits[k]}
                  onChange={e =>
                    setPackage({ ...p, limits: { ...p.limits, [k]: Number(e.target.value) } })
                  }
                />
              </label>
            ))}
          </fieldset>
          <label>
            Built-in checker
            <select
              className={css}
              value={p.checker.kind}
              onChange={e =>
                setPackage({
                  ...p,
                  checker: { ...p.checker, kind: e.target.value as Package['checker']['kind'] },
                })
              }
            >
              <option>exact</option>
              <option>token</option>
              <option>float</option>
            </select>
          </label>
          {p.checker.kind === 'float' && (
            <fieldset>
              <legend>Finite numeric tolerances</legend>
              {(['absolute', 'relative'] as const).map(k => (
                <label key={k}>
                  {k}
                  <input
                    type="number"
                    step="any"
                    className={css}
                    value={p.checker[k]}
                    onChange={e =>
                      setPackage({ ...p, checker: { ...p.checker, [k]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
            </fieldset>
          )}
          <section aria-label="Test cases" className="space-y-3">
            <h2 className="text-xl font-semibold">Samples and private cases</h2>
            {p.cases.map((t, i) => (
              <fieldset className="border rounded p-3 space-y-2" key={i}>
                <legend>Case {i + 1}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={t.sample}
                    onChange={e =>
                      setPackage({
                        ...p,
                        cases: p.cases.map((c, n) =>
                          n === i ? { ...c, sample: e.target.checked } : c
                        ),
                      })
                    }
                  />{' '}
                  Public sample (unchecked cases stay private)
                </label>
                {(['input', 'output', 'explanation'] as const).map(k => (
                  <label className="block" key={k}>
                    {k === 'output' ? 'Expected output' : k}
                    <textarea
                      className={css}
                      value={t[k]}
                      onChange={e =>
                        setPackage({
                          ...p,
                          cases: p.cases.map((c, n) =>
                            n === i ? { ...c, [k]: e.target.value } : c
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setPackage({ ...p, cases: p.cases.filter((_, n) => n !== i) })}
                >
                  Remove case
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="border p-2"
              onClick={() =>
                setPackage({
                  ...p,
                  cases: [...p.cases, { input: '', output: '', explanation: '', sample: false }],
                })
              }
            >
              Add private case
            </button>
          </section>
          <section aria-label="Reference solutions" className="space-y-3">
            <h2 className="text-xl font-semibold">Private reference solutions</h2>
            {p.references.map((r, i) => (
              <fieldset key={i} className="border p-3">
                <legend>Reference {i + 1}</legend>
                <label>
                  Reference language
                  <select
                    aria-label="Reference language"
                    className={css}
                    value={r.language}
                    onChange={e =>
                      setPackage({
                        ...p,
                        references: p.references.map((x, n) =>
                          n === i ? { ...x, language: e.target.value as typeof r.language } : x
                        ),
                      })
                    }
                  >
                    {PRACTICE_LANGUAGES.map(l => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reference code
                  <textarea
                    className={`${css} font-mono`}
                    value={r.code}
                    onChange={e =>
                      setPackage({
                        ...p,
                        references: p.references.map((x, n) =>
                          n === i ? { ...x, code: e.target.value } : x
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Complexity and limits rationale
                  <textarea
                    className={css}
                    value={r.complexity}
                    onChange={e =>
                      setPackage({
                        ...p,
                        references: p.references.map((x, n) =>
                          n === i ? { ...x, complexity: e.target.value } : x
                        ),
                      })
                    }
                  />
                </label>
              </fieldset>
            ))}
          </section>
          <section aria-label="Starter code">
            <h2 className="text-xl font-semibold">Public starter code</h2>
            {p.languages.map(l => (
              <label className="block" key={l}>
                {l} starter
                <textarea
                  className={`${css} font-mono`}
                  value={p.starters[l] ?? ''}
                  onChange={e =>
                    setPackage({ ...p, starters: { ...p.starters, [l]: e.target.value } })
                  }
                />
              </label>
            ))}
          </section>
          <label>
            Hints (one per line)
            <textarea
              className={css}
              value={p.hints.join('\n')}
              onChange={e =>
                setPackage({ ...p, hints: e.target.value.split('\n').filter(Boolean) })
              }
            />
          </label>
          {text('editorial', 'Public editorial Markdown')}
          {text('rightsBasis', 'Source and rights basis')}
          <button
            disabled={busy || !canAuthor}
            className="border rounded p-3 disabled:opacity-50"
            type="submit"
          >
            Save new immutable version
          </button>
        </form>
        {selected && (
          <section aria-label="Version review" className="border rounded p-4 space-y-3">
            <h2 className="text-xl font-semibold">Review exact saved version</h2>
            <p role="status">
              {availability} Version status: {selected.status}
            </p>
            {selected.jobs?.map(j => (
              <p key={j.id}>
                Reference: {j.verdict ?? j.state}
                {j.failureCode ? ` (${j.failureCode})` : ''}
              </p>
            ))}
            <button onClick={() => void open(selected.id)}>Refresh validation status</button>
            <p>
              Review uses the saved package hash. Unsaved editor changes are not part of this
              version.
            </p>
            <button
              className="border p-2"
              disabled={
                busy ||
                !canAuthor ||
                !executionEnabled ||
                !['DRAFT', 'VALIDATED'].includes(selected.status)
              }
              onClick={() => void action('validate')}
            >
              Validate reference solution
            </button>
            <label className="block">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={e => setRightsConfirmed(e.target.checked)}
              />{' '}
              I independently reviewed the saved tests, solutions and rights basis.
            </label>
            <button
              className="border p-2"
              disabled={
                busy ||
                !canReview ||
                !executionEnabled ||
                selected.status !== 'VALIDATED' ||
                selected.authorId === user?.id ||
                !rightsConfirmed
              }
              onClick={() => void action('publish')}
            >
              Publish reviewed version
            </button>
            <label className="block">
              Withdrawal reason
              <textarea className={css} value={reason} onChange={e => setReason(e.target.value)} />
            </label>
            <button
              className="border p-2"
              disabled={busy || !canReview || reason.trim().length < 10}
              onClick={() => void action('withdraw')}
            >
              Withdraw version
            </button>
          </section>
        )}
      </main>
    </AdminShell>
  )
}
