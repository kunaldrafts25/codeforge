'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Search } from 'lucide-react'
import { useDebounce } from '@/lib/hooks'

interface Problem {
  id: string
  slug: string
  title: string
  difficulty: number
  tags: string[]
  solveCount: number
  attemptCount: number
}

interface FetchParams {
  page: number
  limit: number
  difficulty?: string
  tag?: string
  search?: string
}

const difficulties = ['All', 'Easy', 'Medium', 'Hard', 'Expert']

const POPULAR_TAGS = [
  'array',
  'string',
  'dynamic-programming',
  'graphs',
  'math',
  'sorting',
  'binary-search',
  'greedy',
  'trees',
  'recursion',
  'hash-table',
  'two-pointers',
]

export default function ProblemsPage() {
  const [problems, setProblems] = useState<Problem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [difficulty, setDifficulty] = useState('All')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchProblems = useCallback(async () => {
    try {
      setLoading(true)
      const params: FetchParams = { page, limit: 20 }
      if (difficulty !== 'All') params.difficulty = difficulty.toLowerCase()
      if (selectedTags.length > 0) params.tag = selectedTags[0]
      if (debouncedSearch) params.search = debouncedSearch

      const res = await api.get('/problems', { params })
      setProblems(res.data.problems)
      setTotalPages(res.data.totalPages)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch problems:', err)
    } finally {
      setLoading(false)
    }
  }, [page, difficulty, selectedTags, debouncedSearch])

  useEffect(() => {
    fetchProblems()
  }, [fetchProblems])

  // No longer need client-side filtering since search is handled by the API
  const filteredProblems = problems

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]))
    setPage(1)
  }

  const clearTags = () => {
    setSelectedTags([])
    setPage(1)
  }

  const getDifficultyLabel = (level: number) => {
    if (level <= 2) return 'Easy'
    if (level <= 5) return 'Medium'
    if (level <= 8) return 'Hard'
    return 'Expert'
  }

  const getDifficultyBadgeClass = (level: number) => {
    if (level <= 2) return 'bg-green-500/10 text-green-500 border-green-500/20'
    if (level <= 5) return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20'
    if (level <= 8) return 'bg-purple-500/10 text-purple-500 border-purple-500/20'
    return 'bg-red-500/10 text-red-500 border-red-500/20'
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
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

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {POPULAR_TAGS.map(tag => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={cn(
              'px-3 py-1 rounded-full text-sm transition-colors border',
              selectedTags.includes(tag)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/40 hover:bg-muted/70 text-muted-foreground border-border'
            )}
            type="button"
          >
            {tag}
          </button>
        ))}

        {selectedTags.length > 0 && (
          <button
            onClick={clearTags}
            className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            type="button"
          >
            Clear
          </button>
        )}
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
                Statistics
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
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs font-medium',
                        getDifficultyBadgeClass(problem.difficulty)
                      )}
                    >
                      {getDifficultyLabel(problem.difficulty)}
                    </Badge>
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
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex flex-col items-end gap-1">
                      <div className="text-sm font-medium text-foreground">
                        {problem.solveCount}{' '}
                        <span className="text-muted-foreground font-normal">solved</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {problem.attemptCount > 0 ? (
                          <span>
                            Acceptance:{' '}
                            <span className="text-foreground">
                              {Math.round((problem.solveCount / problem.attemptCount) * 100)}%
                            </span>
                          </span>
                        ) : (
                          <span>No attempts yet</span>
                        )}
                      </div>
                    </div>
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
