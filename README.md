# CodeForge

AI-powered competitive programming platform for GFG MIT-ADT.

## Quick Start

```bash
# Install all dependencies
npm run install:all

# Start development servers
npm run dev
```

Frontend runs on `http://localhost:3000`
Backend runs on `http://localhost:5000`

## Project Structure

```
codeforge/
├── frontend/          # Next.js 14 app
├── backend/           # Express API server
├── docker/            # Docker configs
└── docs/              # Documentation
```

## Tech Stack

- **Frontend**: Next.js 14, Tailwind CSS, shadcn/ui, Monaco Editor
- **Backend**: Node.js, Express, Prisma, PostgreSQL
- **Real-time**: Socket.io

## Environment Setup

Copy the example env files:

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

## Team

Built by Kunal Singh
