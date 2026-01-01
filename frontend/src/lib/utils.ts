import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatTime(date: Date | string) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getDifficultyColor(level: number) {
  if (level <= 2) return 'text-green-500'
  if (level <= 4) return 'text-cyan-500'
  if (level <= 6) return 'text-blue-500'
  if (level <= 8) return 'text-purple-500'
  return 'text-red-500'
}

export function getRatingColor(rating: number) {
  if (rating >= 2400) return 'text-red-600'
  if (rating >= 2100) return 'text-orange-500'
  if (rating >= 1900) return 'text-purple-600'
  if (rating >= 1600) return 'text-blue-600'
  if (rating >= 1400) return 'text-cyan-600'
  if (rating >= 1200) return 'text-green-600'
  return 'text-gray-500'
}

export function getRatingTitle(rating: number) {
  if (rating >= 2400) return 'Grandmaster'
  if (rating >= 2100) return 'Master'
  if (rating >= 1900) return 'Candidate Master'
  if (rating >= 1600) return 'Expert'
  if (rating >= 1400) return 'Specialist'
  if (rating >= 1200) return 'Pupil'
  return 'Newbie'
}
