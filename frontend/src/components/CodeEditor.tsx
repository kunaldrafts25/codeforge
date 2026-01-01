'use client'

import dynamic from 'next/dynamic'
import { useTheme } from '@/components/ThemeProvider'

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: string
  height?: string
  readOnly?: boolean
}

const languageMap: Record<string, string> = {
  cpp: 'cpp',
  c: 'c',
  python: 'python',
  java: 'java',
  javascript: 'javascript',
}

export function CodeEditor({
  value,
  onChange,
  language,
  height = '400px',
  readOnly = false,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <Editor
        height={height}
        language={languageMap[language] || 'plaintext'}
        value={value}
        onChange={val => onChange(val || '')}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          readOnly,
          wordWrap: 'on',
        }}
      />
    </div>
  )
}
