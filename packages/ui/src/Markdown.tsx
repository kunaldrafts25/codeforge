import DOMPurify from 'isomorphic-dompurify'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false, // Reject raw HTML in markdown — defense in depth alongside DOMPurify
  linkify: true,
  typographer: true,
  breaks: false,
})

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'object', 'embed', 'link'],
  FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
}

export function renderMarkdown(input: string | null | undefined): string {
  if (!input) return ''
  const rendered = md.render(input)
  // DOMPurify.sanitize with default RETURN_TRUSTED_TYPE=false returns string.
  // The DOM types expose TrustedHTML; coerce explicitly.
  return String(DOMPurify.sanitize(rendered, PURIFY_CONFIG))
}

interface MarkdownProps {
  md: string | null | undefined
  className?: string
}

export function Markdown({ md: source, className }: MarkdownProps): JSX.Element {
  const html = renderMarkdown(source)
  // The output of renderMarkdown is sanitized through DOMPurify (configured to
  // strip scripts/styles/event handlers). This is the SINGLE permitted use of
  // dangerouslySetInnerHTML across the application — see SECURITY.md.
  // eslint-disable-next-line react/no-danger
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
