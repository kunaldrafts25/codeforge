import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './Markdown'

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const out = renderMarkdown('# Hello\n\nworld')
    expect(out).toContain('<h1>')
    expect(out).toContain('Hello')
  })

  it('strips <script> tags', () => {
    // Raw HTML is rejected by markdown-it (html: false). Even if it made it
    // through, DOMPurify forbids <script>. The `alert(...)` text may survive
    // as harmless text — what matters is it cannot be executed.
    const out = renderMarkdown('hello <script>alert(1)</script> world')
    expect(out).not.toMatch(/<script\b/i)
    expect(out).toContain('&lt;script')
  })

  it('encodes raw HTML so event handlers cannot execute', () => {
    // markdown-it ships with `html: false` so any raw HTML in markdown is
    // text-escaped, never rendered. The string `onclick=` may appear as
    // literal text, but no <a> tag is emitted.
    const out = renderMarkdown('<a href="x" onclick="alert(1)">click</a>')
    expect(out).not.toMatch(/<a\b[^>]*onclick/i)
    expect(out).toContain('&lt;a')
  })

  it('returns empty string for nullish input', () => {
    expect(renderMarkdown(undefined)).toBe('')
    expect(renderMarkdown(null)).toBe('')
    expect(renderMarkdown('')).toBe('')
  })
})
