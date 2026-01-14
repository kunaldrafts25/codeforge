import express from 'express'
import cors from 'cors'

const app = express()

app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
  })
)

app.use(express.json())

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'CodeForge API Server - Test Mode',
    version: '0.1.0-test',
    endpoints: {
      auth: '/api/auth/login',
      health: '/api/health',
    },
  })
})

// Simple test endpoint
app.get('/api/test', (req, res) => {
  console.log('Test endpoint called')
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() })
})

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Test login endpoint
app.post('/api/auth/login', (req, res) => {
  console.log('=== LOGIN REQUEST RECEIVED ===')
  console.log('Headers:', req.headers)
  console.log('Body:', req.body)
  console.log('Method:', req.method)
  console.log('URL:', req.url)

  const { email, password } = req.body

  if (email === 'admin@gfgmitadt.in' && password === 'admin123') {
    console.log('✅ Login successful for:', email)
    const response = {
      user: {
        id: 'test-admin-id',
        email: 'admin@gfgmitadt.in',
        username: 'admin',
        displayName: 'Admin',
        rating: 2000,
        role: 'SUPER_ADMIN',
      },
      token: 'test-jwt-token-12345',
    }
    console.log('Sending response:', response)
    res.json(response)
  } else {
    console.log('❌ Login failed for:', email)
    res.status(401).json({ message: 'Invalid credentials' })
  }
})

// Auth me endpoint
app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (token === 'test-jwt-token-12345') {
    res.json({
      user: {
        id: 'test-admin-id',
        email: 'admin@gfgmitadt.in',
        username: 'admin',
        displayName: 'Admin',
        rating: 2000,
        role: 'SUPER_ADMIN',
      },
    })
  } else {
    res.status(401).json({ message: 'Not authenticated' })
  }
})

// Leaderboard endpoint
app.get('/api/leaderboard', (req, res) => {
  res.json([
    {
      id: 'test-admin-id',
      username: 'admin',
      displayName: 'Admin',
      avatarUrl: null,
      rating: 2000,
      maxRating: 2000,
      problemsSolved: 0,
      contestsCount: 0,
    },
  ])
})

// Ratings endpoints
app.get('/api/ratings/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (token === 'test-jwt-token-12345') {
    res.json({
      id: 'test-admin-id',
      username: 'admin',
      displayName: 'Admin',
      rating: 2000,
      maxRating: 2000,
      problemsSolved: 0,
      contestsCount: 0,
    })
  } else {
    res.status(401).json({ message: 'Not authenticated' })
  }
})

app.get('/api/ratings/top', (req, res) => {
  res.json([
    {
      id: 'test-admin-id',
      username: 'admin',
      displayName: 'Admin',
      avatarUrl: null,
      rating: 2000,
      maxRating: 2000,
      problemsSolved: 0,
      contestsCount: 0,
    },
  ])
})

app.get('/api/ratings/distribution', (req, res) => {
  res.json({
    '2000-2099': 1,
  })
})

app.get('/api/ratings/history', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (token === 'test-jwt-token-12345') {
    res.json([])
  } else {
    res.status(401).json({ message: 'Not authenticated' })
  }
})

// Problems endpoint
app.get('/api/problems', (req, res) => {
  res.json({
    problems: [
      {
        id: 'two-sum',
        slug: 'two-sum',
        title: 'Two Sum',
        difficulty: 1,
        tags: ['arrays', 'hashing'],
        solveCount: 1250,
        attemptCount: 2100,
        description:
          'Given an array of integers and a target, return indices of two numbers that add up to the target.',
        timeLimit: 1000,
        memoryLimit: 256,
      },
      {
        id: 'palindrome-check',
        slug: 'palindrome-check',
        title: 'Palindrome Check',
        difficulty: 1,
        tags: ['strings'],
        solveCount: 890,
        attemptCount: 1200,
        description: 'Check if a given string is a palindrome.',
        timeLimit: 1000,
        memoryLimit: 256,
      },
      {
        id: 'fibonacci-number',
        slug: 'fibonacci-number',
        title: 'Fibonacci Number',
        difficulty: 2,
        tags: ['dynamic-programming', 'recursion'],
        solveCount: 650,
        attemptCount: 980,
        description: 'Calculate the nth Fibonacci number.',
        timeLimit: 1000,
        memoryLimit: 256,
      },
    ],
    totalPages: 1,
    currentPage: 1,
    totalProblems: 3,
  })
})

// Individual problem endpoint
app.get('/api/problems/:slug', (req, res) => {
  const { slug } = req.params

  const problems = {
    'two-sum': {
      id: 'two-sum',
      slug: 'two-sum',
      title: 'Two Sum',
      difficulty: 1,
      tags: ['arrays', 'hashing'],
      solveCount: 1250,
      attemptCount: 2100,
      description:
        'Given an array of integers and a target, return indices of two numbers that add up to the target.',
      timeLimit: 1000,
      memoryLimit: 256,
      examples: [
        {
          input: '[2,7,11,15]\n9',
          output: '[0,1]',
          explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].',
        },
      ],
    },
    'palindrome-check': {
      id: 'palindrome-check',
      slug: 'palindrome-check',
      title: 'Palindrome Check',
      difficulty: 1,
      tags: ['strings'],
      solveCount: 890,
      attemptCount: 1200,
      description: 'Check if a given string is a palindrome.',
      timeLimit: 1000,
      memoryLimit: 256,
      examples: [
        {
          input: '"racecar"',
          output: 'true',
          explanation: 'The string "racecar" reads the same forwards and backwards.',
        },
      ],
    },
    'fibonacci-number': {
      id: 'fibonacci-number',
      slug: 'fibonacci-number',
      title: 'Fibonacci Number',
      difficulty: 2,
      tags: ['dynamic-programming', 'recursion'],
      solveCount: 650,
      attemptCount: 980,
      description: 'Calculate the nth Fibonacci number.',
      timeLimit: 1000,
      memoryLimit: 256,
      examples: [
        {
          input: '5',
          output: '5',
          explanation: 'The 5th Fibonacci number is 5 (0, 1, 1, 2, 3, 5).',
        },
      ],
    },
  }

  const problem = problems[slug]
  if (problem) {
    res.json(problem)
  } else {
    res.status(404).json({ message: 'Problem not found' })
  }
})

app.listen(5000, () => {
  console.log('Test server running on port 5000')
})
