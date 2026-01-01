# Contributing to CodeForge

Welcome to CodeForge! This guide will help you get started with contributing to our competitive programming platform.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Git Workflow](#git-workflow)
- [Pull Request Process](#pull-request-process)
- [Code Review Guidelines](#code-review-guidelines)

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/gfg-mitadt/codeforge.git
cd codeforge

# Install all dependencies
npm run install:all

# Set up Husky (pre-commit hooks)
npx husky install

# Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Start development servers
npm run dev
```

### Environment Variables

**Backend (`backend/.env`):**

```
DATABASE_URL="your-supabase-url"
JWT_SECRET="random-secret-key"
```

**Frontend (`frontend/.env.local`):**

```
NEXT_PUBLIC_API_URL="http://localhost:5000"
NEXT_PUBLIC_WS_URL="http://localhost:5000"
```

---

## Development Workflow

### Daily Workflow

1. Pull latest changes from `develop`
2. Create a feature branch
3. Make your changes
4. Run linting: `npm run lint`
5. Test locally
6. Commit with a meaningful message
7. Push and create a PR

### Running the App

```bash
# Both frontend and backend
npm run dev

# Frontend only (http://localhost:3000)
cd frontend && npm run dev

# Backend only (http://localhost:5000)
cd backend && npm run dev
```

### Useful Commands

| Command           | Description               |
| ----------------- | ------------------------- |
| `npm run dev`     | Start both servers        |
| `npm run lint`    | Run ESLint on all code    |
| `npm run format`  | Format code with Prettier |
| `npm run build`   | Build for production      |
| `npm run db:push` | Push Prisma schema to DB  |
| `npm run db:seed` | Seed sample data          |

---

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Avoid `any` type - use proper types or `unknown`
- Use interfaces for object shapes
- Export types alongside functions

```typescript
// Good
interface User {
  id: string
  email: string
  rating: number
}

export function getUser(id: string): Promise<User> {
  // ...
}

// Bad
export function getUser(id: any): Promise<any> {
  // ...
}
```

### Naming Conventions

| Type               | Convention  | Example                             |
| ------------------ | ----------- | ----------------------------------- |
| Variables          | camelCase   | `userName`, `contestId`             |
| Functions          | camelCase   | `fetchProblems()`, `handleSubmit()` |
| Components         | PascalCase  | `ProblemCard`, `Navbar`             |
| Files (components) | PascalCase  | `ProblemCard.tsx`                   |
| Files (utilities)  | camelCase   | `api.ts`, `utils.ts`                |
| Constants          | UPPER_SNAKE | `MAX_RATING`, `API_URL`             |
| Types/Interfaces   | PascalCase  | `User`, `Problem`                   |

### React Components

```tsx
// Use function components with TypeScript
interface Props {
  title: string
  rating: number
  onSolve?: () => void
}

export function ProblemCard({ title, rating, onSolve }: Props) {
  return (
    <div className="...">
      <h3>{title}</h3>
      <span>{rating}</span>
      {onSolve && <button onClick={onSolve}>Solve</button>}
    </div>
  )
}
```

### CSS / Styling

- Use Tailwind CSS classes
- Follow the GFG MIT-ADT color palette
- Use CSS variables for theme colors
- Keep class lists readable with line breaks for long lists

```tsx
// Good
<div className="
  flex items-center gap-4 p-4
  bg-card border border-border rounded-lg
  hover:shadow-lg transition-shadow
">

// Bad - too long single line
<div className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg hover:shadow-lg transition-shadow">
```

### API Routes (Backend)

```typescript
// Route structure
router.get('/', async (req, res) => {
  try {
    const data = await prisma.problem.findMany()
    res.json(data)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Failed to fetch' })
  }
})

// Always:
// - Use try/catch
// - Return meaningful error messages
// - Log errors for debugging
// - Use proper HTTP status codes
```

### Error Handling

- Always catch async errors
- Use meaningful error messages
- Log errors with context
- Return user-friendly messages

```typescript
try {
  await submitCode(code, problemId)
} catch (err) {
  console.error('Submission failed:', err)
  toast.error('Failed to submit. Please try again.')
}
```

---

## Git Workflow

### Branch Naming

```
feature/user-profile
feature/contest-leaderboard
fix/login-redirect
fix/rating-calculation
chore/update-deps
docs/api-documentation
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add user profile page
fix: correct rating calculation
docs: update API documentation
style: format code with prettier
refactor: simplify submission logic
test: add contest registration tests
chore: update dependencies
```

### Branch Strategy

```
main (protected)
  └── develop
        ├── feature/user-profile
        ├── feature/contest-timer
        └── fix/login-error
```

- `main`: Production-ready code
- `develop`: Integration branch
- `feature/*`: New features
- `fix/*`: Bug fixes

---

## Pull Request Process

### Before Creating a PR

- [ ] Run `npm run lint` and fix errors
- [ ] Test your changes locally
- [ ] Update documentation if needed
- [ ] Rebase on latest `develop`

### PR Title Format

```
feat: add problem difficulty filter
fix: resolve leaderboard sorting issue
docs: update setup instructions
```

### PR Description

Use the PR template. Include:

- What changes were made
- Why they were made
- How to test
- Screenshots for UI changes

### Review Process

1. Create PR from your branch to `develop`
2. Request review from at least 1 team member
3. Address review comments
4. Squash and merge when approved

---

## Code Review Guidelines

### For Authors

- Keep PRs small and focused
- Respond to feedback promptly
- Explain your decisions
- Be open to suggestions

### For Reviewers

- Be respectful and constructive
- Focus on logic and correctness
- Suggest improvements, don't demand
- Approve promptly when ready

### What to Look For

- Code correctness
- Error handling
- Performance concerns
- Security issues
- Type safety
- Naming clarity
- Code duplication

---
