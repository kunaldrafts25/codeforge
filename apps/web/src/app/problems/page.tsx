'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { logger } from '@/lib/logger'
import { getDifficultyBandColor, cn } from '@/lib/utils'
import { Search } from 'lucide-react'

interface Problem {
  id: string
  slug: string
  title: string
  difficultyBand: string
  rating: number
  tags: string[]
  totalAccepted: number
  totalSubmissions: number
  acceptanceRate: number
}

interface FetchParams {
  page: number
  limit: number
  difficulty?: string
}

const difficulties = ['All', 'Easy', 'Medium', 'Hard', 'Expert']

export default function ProblemsPage() {
  const [problems, setProblems] = useState<Problem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [difficulty, setDifficulty] = useState('All')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchProblems = useCallback(async () => {
    try {
      setLoading(true)
      const params: FetchParams = { page, limit: 20 }
      if (difficulty !== 'All') params.difficulty = difficulty.toLowerCase()

      const res = await api.get('/problems', { params })
      setProblems(res.data.problems)
      setTotalPages(res.data.totalPages)
    } catch (err) {
      logger.error('Failed to fetch problems:', err)
    } finally {
      setLoading(false)
    }
  }, [page, difficulty])

  useEffect(() => {
    void fetchProblems()
  }, [fetchProblems])

  const filteredProblems = problems.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  )

  const labelFor = (band: string): string =>
    band.length > 0 ? band[0]!.toUpperCase() + band.slice(1) : band

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <p role="status" className="mb-5 rounded border border-amber-500 p-3">
        Coding submissions are unavailable during the aptitude pilot.
      </p>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <h1 className="text-3xl font-bold">Problems</h1>

        <div className="flex gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search problems..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring w-64"
            />
          </div>

          <select
            value={difficulty}
            onChange={e => setDifficulty(e.target.value)}
            className="px-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {difficulties.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">
                Title
              </th>
              <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground hidden md:table-cell">
                Difficulty
              </th>
              <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">
                Tags
              </th>
              <th className="text-right px-6 py-4 text-sm font-medium text-muted-foreground">
                Acceptance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : filteredProblems.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                  No problems found
                </td>
              </tr>
            ) : (
              filteredProblems.map(problem => (
                <tr key={problem.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <Link
                      href={`/problems/${problem.slug}`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {problem.title}
                    </Link>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        getDifficultyBandColor(problem.difficultyBand)
                      )}
                    >
                      {labelFor(problem.difficultyBand)}
                    </span>
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <div className="flex gap-2 flex-wrap">
                      {problem.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-muted-foreground">
                    {problem.totalSubmissions > 0
                      ? `${Math.round((problem.totalAccepted / problem.totalSubmissions) * 100)}%`
                      : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={cn(
                'px-3 py-1 rounded-lg text-sm',
                page === i + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
