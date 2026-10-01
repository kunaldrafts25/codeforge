import { createServer } from 'node:http'

const messages = []
const port = Number(process.env.MAIL_SANDBOX_PORT ?? 8025)
const host = process.env.MAIL_SANDBOX_HOST ?? '127.0.0.1'

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  response.setHeader('Content-Type', 'application/json')
  if (request.method === 'GET' && url.pathname === '/messages') {
    response.end(JSON.stringify(messages.filter(message =>
      !url.searchParams.has('to') || message.to === url.searchParams.get('to'))))
    return
  }
  if (request.method === 'DELETE' && url.pathname === '/messages') {
    messages.length = 0
    response.end('{}')
    return
  }
  if (request.method !== 'POST' || url.pathname !== '/messages') {
    response.writeHead(404).end('{}')
    return
  }
  let body = ''
  request.on('data', chunk => {
    body += chunk
    if (body.length > 16_384) request.destroy()
  })
  request.on('end', () => {
    try {
      const message = JSON.parse(body)
      if (typeof message.to !== 'string' || typeof message.body !== 'string') throw Error()
      messages.push(message)
      response.writeHead(201).end('{}')
    } catch {
      response.writeHead(400).end('{}')
    }
  })
}).listen(port, host)
