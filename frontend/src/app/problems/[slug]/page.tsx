'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import { socket } from '@/lib/socket'
import { CodeEditor } from '@/components/CodeEditor'
import { getDifficultyColor, cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { Send, Clock, Database, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import type { AxiosError } from 'axios'

interface Problem {
  id: string
  title: string
  description: string
  inputFormat: string
  outputFormat: string
  constraints: string
  difficulty: number
  timeLimit: number
  memoryLimit: number
  samples: { input: string; output: string; explanation?: string }[]
  tags: string[]
}

interface SubmissionResult {
  verdict?: string
  testCasesPassed?: number
  totalTestCases?: number
  executionTime?: number
  memoryUsed?: number
  message?: string
}

const languages = [
  { id: 'cpp', name: 'C++ 17' },
  { id: 'c', name: 'C' },
  { id: 'python', name: 'Python 3' },
  { id: 'java', name: 'Java' },
  { id: 'javascript', name: 'JavaScript' },
]

const defaultCode: Record<string, string> = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}',
  c: '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}',
  python: '',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n    }\n}',
  javascript: 'const readline = require("readline");\n\n',
}

export default function ProblemPage() {
  const params = useParams()
  const slug = params?.slug as string
  const [problem, setProblem] = useState<Problem | null>(null)
  const [loading, setLoading] = useState(true)
  const [language, setLanguage] = useState('cpp')
  const [code, setCode] = useState(defaultCode.cpp)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmissionResult | null>(null)
  const [activeTab, setActiveTab] = useState<'description' | 'submissions'>('description')

  const fetchProblem = useCallback(async () => {
    try {
      const res = await api.get(`/problems/${slug}`)
      setProblem(res.data)
    } catch (err) {
      logger.error('Failed to fetch problem:', err)
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    fetchProblem()
  }, [fetchProblem])

  useEffect(() => {
    setCode(defaultCode[language] || '')
  }, [language])

  const handleSubmit = async () => {
    if (!problem || submitting) return

    setSubmitting(true)
    setResult(null)

    try {
      const res = await api.post('/submissions', {
        problemId: problem.id,
        language,
        code,
      })

      const submissionId = res.data.id

      // Connect socket FIRST, then track
      socket.connect()

      // Small delay to ensure socket is connected
      setTimeout(() => {
        socket.trackSubmission(submissionId, data => {
          setResult(data)
          if (data.verdict && data.verdict !== 'pending' && data.verdict !== 'running') {
            setSubmitting(false)
          }
        })
      }, 100)

      // Fallback: Poll for result if WebSocket doesn't respond
      const pollForResult = async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const subRes = await api.get(`/submissions/${submissionId}`)
            const sub = subRes.data
            if (sub.verdict !== 'PENDING' && sub.verdict !== 'RUNNING') {
              setResult({
                verdict: sub.verdict.toLowerCase(),
                testCasesPassed: sub.testsPassed,
                totalTestCases: sub.testsTotal,
                executionTime: sub.executionTime,
                memoryUsed: sub.memoryUsed,
              })
              setSubmitting(false)
              return
            }
          } catch (pollErr) {
            logger.error('Poll error:', pollErr)
          }
        }
        // Timeout after 2 minutes
        setResult({ verdict: 'error', message: 'Judging timed out' })
        setSubmitting(false)
      }

      pollForResult()
    } catch (err) {
      const error = err as AxiosError<{ message: string }>
      setResult({ verdict: 'error', message: error.response?.data?.message || 'Submission failed' })
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!problem) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <p className="text-muted-foreground">Problem not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-4rem)]">
      <div className="lg:w-1/2 p-6 overflow-y-auto border-r border-border">
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold">{problem.title}</h1>
            <span className={cn('text-sm font-medium', getDifficultyColor(problem.difficulty))}>
              {problem.difficulty <= 2
                ? 'Easy'
                : problem.difficulty <= 5
                  ? 'Medium'
                  : problem.difficulty <= 8
                    ? 'Hard'
                    : 'Expert'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" /> {problem.timeLimit}ms
            </span>
            <span className="flex items-center gap-1">
              <Database className="w-4 h-4" /> {problem.memoryLimit / 1024}MB
            </span>
          </div>
        </div>

        <div className="flex gap-4 border-b border-border mb-4">
          <button
            onClick={() => setActiveTab('description')}
            className={cn(
              'py-2 px-4 -mb-px border-b-2 transition-colors',
              activeTab === 'description'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Description
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            className={cn(
              'py-2 px-4 -mb-px border-b-2 transition-colors',
              activeTab === 'submissions'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Submissions
          </button>
        </div>

        {activeTab === 'description' && (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div dangerouslySetInnerHTML={{ __html: problem.description }} />

            <h3>Input Format</h3>
            <p>{problem.inputFormat}</p>

            <h3>Output Format</h3>
            <p>{problem.outputFormat}</p>

            <h3>Constraints</h3>
            <pre className="bg-muted p-4 rounded-lg">{problem.constraints}</pre>

            {problem.samples.map((sample, idx) => (
              <div key={idx}>
                <h3>Sample {idx + 1}</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium mb-1">Input</h4>
                    <pre className="bg-muted p-3 rounded-lg text-sm">{sample.input}</pre>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium mb-1">Output</h4>
                    <pre className="bg-muted p-3 rounded-lg text-sm">{sample.output}</pre>
                  </div>
                </div>
                {sample.explanation && (
                  <p className="text-sm text-muted-foreground mt-2">{sample.explanation}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'submissions' && (
          <div className="text-muted-foreground text-sm">Your submissions will appear here.</div>
        )}
      </div>

      <div className="lg:w-1/2 flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {languages.map(lang => (
              <option key={lang.id} value={lang.id}>
                {lang.name}
              </option>
            ))}
          </select>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Judging...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" /> Submit
              </>
            )}
          </button>
        </div>

        <div className="flex-1 p-4">
          <CodeEditor
            value={code}
            onChange={setCode}
            language={language}
            height="calc(100vh - 16rem)"
          />
        </div>

        {result && (
          <div
            className={cn(
              'p-4 border-t border-border',
              result.verdict === 'accepted'
                ? 'bg-green-500/10'
                : result.verdict === 'wrong_answer'
                  ? 'bg-red-500/10'
                  : result.verdict === 'time_limit'
                    ? 'bg-yellow-500/10'
                    : 'bg-muted'
            )}
          >
            <div className="flex items-center gap-2">
              {result.verdict === 'accepted' && <CheckCircle className="w-5 h-5 text-green-500" />}
              {result.verdict === 'wrong_answer' && <XCircle className="w-5 h-5 text-red-500" />}
              {result.verdict === 'time_limit' && (
                <AlertCircle className="w-5 h-5 text-yellow-500" />
              )}
              {result.verdict === 'running' && <Loader2 className="w-5 h-5 animate-spin" />}
              <span className="font-medium capitalize">{result.verdict?.replace('_', ' ')}</span>
              {result.testCasesPassed !== undefined && (
                <span className="text-sm text-muted-foreground ml-2">
                  ({result.testCasesPassed}/{result.totalTestCases} passed)
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
