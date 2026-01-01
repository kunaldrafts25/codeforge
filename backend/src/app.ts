import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import dotenv from 'dotenv'

import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import problemRoutes from './routes/problems.js'
import contestRoutes from './routes/contests.js'
import submissionRoutes from './routes/submissions.js'
import leaderboardRoutes from './routes/leaderboard.js'
import adminRoutes from './routes/admin.js'
import { setupSocket } from './socket/index.js'
import { errorHandler } from './middleware/error.js'

dotenv.config()

const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
)
app.use(express.json({ limit: '5mb' }))

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/problems', problemRoutes)
app.use('/api/contests', contestRoutes)
app.use('/api/submissions', submissionRoutes)
app.use('/api/leaderboard', leaderboardRoutes)
app.use('/api/admin', adminRoutes)

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'CodeForge API Server',
    version: '0.1.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      problems: '/api/problems',
      contests: '/api/contests',
      submissions: '/api/submissions',
      leaderboard: '/api/leaderboard',
      admin: '/api/admin',
    },
  })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

setupSocket(io)

app.use(errorHandler)

const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export { io }
