import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function statusColor(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
    case 'IN_REVIEW':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    case 'APPROVED':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    case 'PUBLISHED':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    case 'RETIRED':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    default:
      return 'bg-gray-200 text-gray-800'
  }
}
