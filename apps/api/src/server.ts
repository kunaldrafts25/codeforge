import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { attachSockets } from './sockets.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const app = await buildApp()
  await app.ready()

  attachSockets(app.server)

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' })
    logger.info({ port: config.PORT }, 'CodeForge API listening')
  } catch (err) {
    logger.error({ err }, 'failed to start server')
    process.exit(1)
  }
}

void main()
