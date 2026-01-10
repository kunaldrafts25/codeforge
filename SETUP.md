# 🚀 CodeForge Development Setup Guide

Welcome to CodeForge! This comprehensive guide will help you set up your local development environment and start contributing to the project.

---

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Environment Configuration](#environment-configuration)
- [Running the Application](#running-the-application)
- [Team Workflow](#team-workflow)
- [Database Guidelines](#database-guidelines)
- [Troubleshooting](#troubleshooting)
- [Quick Reference](#quick-reference)

---

## Prerequisites

Before you begin, ensure you have the following installed:

| Tool        | Version              | Download                                                |
| ----------- | -------------------- | ------------------------------------------------------- |
| **Node.js** | 20.x or higher       | [nodejs.org](https://nodejs.org/)                       |
| **npm**     | 9.x or higher        | Comes with Node.js                                      |
| **Git**     | Latest               | [git-scm.com](https://git-scm.com/)                     |
| **VS Code** | Latest (recommended) | [code.visualstudio.com](https://code.visualstudio.com/) |

### Verify Installation

```bash
node --version    # Should output v20.x.x or higher
npm --version     # Should output 9.x.x or higher
git --version     # Should output git version 2.x.x
```

---

## Initial Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/kunaldrafts25/codeforge.git
cd codeforge
```

### Step 2: Install Dependencies

```bash
# Install all project dependencies (frontend + backend + root)
npm run install:all
```

This command installs dependencies for:

- Root project (linting, formatting tools)
- Frontend (Next.js, React, Tailwind)
- Backend (Express, Prisma)

### Step 3: Set Up Git Hooks

```bash
npx husky install
```

This enables pre-commit hooks that will:

- ✅ Run ESLint on staged files
- ✅ Format code with Prettier
- ✅ Prevent commits with linting errors

### Step 4: Configure Your Git Identity

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

---

## Environment Configuration

### Backend Environment

Create your backend environment file:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your values:

```env
# Database (DO NOT MODIFY - ye already diya h example env me iske sath no bakchodi)
DATABASE_URL="postgresql://user:password@host:5432/codeforge"

# JWT Secret (Generate your own for local development)
JWT_SECRET="your-super-secret-key-here"

# Server Configuration
PORT=5000
NODE_ENV=development
```

> [!CAUTION]
> **Never commit your `.env` file!** It contains sensitive credentials.

### Frontend Environment

Create your frontend environment file:

```bash
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_WS_URL=http://localhost:5000
```

---

### What You CANNOT Do:

| ❌ Forbidden Command       | Why                      |
| -------------------------- | ------------------------ |
| `npx prisma migrate dev`   | Creates schema changes   |
| `npx prisma migrate reset` | **DELETES ALL DATA**     |
| `npx prisma db push`       | Modifies database schema |
| `npx prisma db seed`       | Modifies database data   |
| Direct SQL queries         | Can corrupt data         |

### What You CAN Do:

| ✅ Safe Command       | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `npx prisma generate` | Generate Prisma Client (doesn't touch DB)    |
| `npx prisma studio`   | View data in browser (read-only recommended) |

## Running the Application

### Development Mode (Recommended)

Start both frontend and backend simultaneously:

```bash
npm run dev
```

| Service     | URL                   |
| ----------- | --------------------- |
| Frontend    | http://localhost:3000 |
| Backend API | http://localhost:5000 |

### Running Services Individually

```bash
# Frontend only
cd frontend && npm run dev

# Backend only
cd backend && npm run dev
```

### Verify Everything Works

1. Open http://localhost:3000 in your browser
2. Check the backend health: http://localhost:5000/api/health
3. If both respond correctly, you're ready to code!

---

## Team Workflow

> [!IMPORTANT]
> **Every team member must work on their own branch.** Never commit directly to `main` or `develop`.

### Branch Strategy

```
main (protected)
  ├── feature/your-name/feature-description
  ├── fix/your-name/bug-description
  └── chore/your-name/task-description
```

- `main`: Production code (protected, no direct pushes)
- `feature/*`: Your feature branches
- `fix/*`: Bug fix branches

### Creating Your Feature Branch

**Always start from the latest `main` branch:**

```bash
# 1. Switch to main and pull latest changes
git checkout main
git pull origin main

# 2. Create your feature branch (use YOUR name!)
git checkout -b feature/your-name/feature-description

# Examples:
git checkout -b feature/rahul/user-profile-page
git checkout -b feature/priya/contest-timer
git checkout -b fix/amit/login-redirect-bug
```

### Daily Workflow

```bash
# 1. Start your day - sync with main
git checkout main
git pull origin main
git checkout your-branch-name
git rebase main

# 2. Make your changes
# ... code ...

# 3. Stage and commit
git add .
git commit -m "feat: add user profile avatar upload"

# 4. Push to remote
git push origin your-branch-name

# 5. Create Pull Request on GitHub
```

### Syncing Your Branch

If `main` has new changes while you're working:

```bash
# Option 1: Rebase (preferred - cleaner history)
git fetch origin
git rebase origin/main

# Option 2: Merge
git fetch origin
git merge origin/main
```

---

## Pull Request Guide

> [!IMPORTANT]
> Every change to the codebase **must go through a Pull Request**. No one pushes directly to `main` .

### Step 1: Finish Your Work on Your Branch

Before creating a PR, ensure:

```bash
# 1. All your changes are committed
git status  # Should show "nothing to commit"

# 2. Your code passes linting
npm run lint

# 3. Push your branch to GitHub
git push origin feature/your-name/your-feature
```

### Step 2: Create the Pull Request on GitHub

1. **Go to the repository**: https://github.com/kunaldrafts25/codeforge

2. **You'll see a yellow banner** saying:

   ```
   "feature/your-name/your-feature had recent pushes — Compare & pull request"
   ```

   Click **"Compare & pull request"**

   _If you don't see the banner:_
   - Click the **"Pull requests"** tab
   - Click **"New pull request"**
   - Set **base**: `main` ← **compare**: `your-branch-name`
   - Click **"Create pull request"**

3. **Fill in the PR details:**

   | Field           | What to Write                                                  |
   | --------------- | -------------------------------------------------------------- |
   | **Title**       | `feat: add user profile page` (use conventional commit format) |
   | **Description** | What you changed and why                                       |
   | **Reviewers**   | Add at least 1 team member                                     |
   | **Labels**      | Select appropriate label (feature, bug, etc.)                  |

### Step 3: Complete the PR Checklist

The template will show checkboxes. **Check all that apply:**

```markdown
- [x] My code follows the project's coding standards
- [x] I have run `npm run lint` and fixed any errors
- [x] I have tested my changes locally
- [x] I have updated documentation if needed
```

### Step 4: Request Review

1. On the right sidebar, click **"Reviewers"**
2. Select at least **one team member** to review your code
3. Click outside to save
4. **Wait for review** — don't merge your own PR!

### Step 5: Address Review Comments

If reviewers request changes:

```bash
# 1. Make the requested changes locally
# ... edit your code ...

# 2. Commit the changes
git add .
git commit -m "fix: address review feedback"

# 3. Push to the same branch (PR updates automatically)
git push origin feature/your-name/your-feature
```

### Step 6: Merge (After Approval)

Once approved:

1. The reviewer (or team lead) will click **"Squash and merge"**
2. Your changes are now in `main`!
3. **Delete your branch** after merge (GitHub offers a button)

### Pull Request Checklist Summary

Before creating your PR, verify:

- [ ] Your branch is named correctly: `feature/your-name/description`
- [ ] You're merging into `main`
- [ ] You've run `npm run lint` with no errors
- [ ] You've tested your changes locally
- [ ] You've written a clear PR title and description
- [ ] You've requested at least 1 reviewer

### Example Pull Request

**Title:**

```
feat: add contest countdown timer
```

**Description:**

```markdown
## Description

Added a real-time countdown timer component to the contest page that shows time remaining.

## Type of Change

- [x] ✨ Feature

## Testing Instructions

1. Navigate to http://localhost:3000/contest/1
2. Observe the countdown timer in the header
3. Verify it updates every second

## Screenshots

[Attach screenshot of the timer]
```

---

## Database Guidelines

> [!CAUTION]
>
> ## 🚫 DATABASE IS OFF-LIMITS
>
> **Do NOT run any database migration or modification commands!**

### If You Need Database Changes:

1. **Don't do it yourself!**
2. Open an issue on GitHub describing your data requirements
3. Tag the team lead: `@kunaldrafts25`
4. Wait for the team lead to make and announce the changes

### Why This Matters:

- We share a single database for development
- Schema changes affect everyone instantly
- Accidental resets = everyone loses their test data
- Migrations must be coordinated carefully

---

## Troubleshooting

### Common Issues

#### ❌ "Cannot find module" errors

```bash
# Reinstall all dependencies
rm -rf node_modules
rm -rf frontend/node_modules
rm -rf backend/node_modules
npm run install:all
```

#### ❌ Port already in use

```bash
# Kill processes on port 3000 or 5000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID_NUMBER> /F

# Mac/Linux:
lsof -i :3000
kill -9 <PID>
```

#### ❌ Prisma Client not generated

```bash
cd backend
npx prisma generate
```

#### ❌ Git rebase conflicts

```bash
# During rebase conflict:
# 1. Fix conflicts in files
# 2. Stage resolved files
git add .
# 3. Continue rebase
git rebase --continue
# 4. Or abort if stuck
git rebase --abort
```

#### ❌ Pre-commit hook failing

```bash
# Run lint to see errors
npm run lint

# Auto-fix most issues
npm run lint -- --fix

# Format code
npm run format
```

---

## Quick Reference

### Essential Commands

```bash
# Start development
npm run dev

# Lint code
npm run lint

# Format code
npm run format

# Generate Prisma client
cd backend && npx prisma generate
```

### Git Workflow Cheatsheet

```bash
# Create branch
git checkout -b feature/your-name/description

# Commit changes
git add .
git commit -m "feat: description"

# Push branch
git push origin your-branch-name

# Sync with develop
git fetch origin
git rebase origin/develop
```

### Project Structure

```
codeforge/
├── frontend/          # Next.js 14 app (React, TypeScript)
│   ├── src/
│   │   ├── app/       # Next.js app router pages
│   │   ├── components/
│   │   └── lib/       # Utilities
│   └── public/        # Static assets
│
├── backend/           # Express API server
│   ├── src/
│   │   ├── routes/    # API endpoints
│   │   ├── middleware/
│   │   └── utils/
│   └── prisma/        # Database schema
│
└── docs/              # Documentation
```

---

## VS Code Extensions (Recommended)

Install these for the best experience:

- **ESLint** - Linting
- **Prettier** - Formatting
- **Tailwind CSS IntelliSense** - CSS autocomplete
- **Prisma** - Database schema highlighting
- **GitLens** - Git integration

---

## Need Help?

- 📖 Check `CONTRIBUTING.md` for coding standards
- 💬 Ask in the team Discord/Slack channel
- 🐛 Open an issue on GitHub
- 👤 Contact team lead: @kunal-singh

---

**Happy Coding! 🎉**
