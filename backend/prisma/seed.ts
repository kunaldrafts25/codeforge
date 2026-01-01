import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@gfgmitadt.in' },
    update: {},
    create: {
      email: 'admin@gfgmitadt.in',
      username: 'admin',
      displayName: 'Admin',
      passwordHash: adminPassword,
      role: 'SUPER_ADMIN',
      rating: 2000,
      maxRating: 2000,
    },
  })

  console.log('Created admin:', admin.username)

  const problem1 = await prisma.problem.upsert({
    where: { slug: 'two-sum' },
    update: {},
    create: {
      slug: 'two-sum',
      title: 'Two Sum',
      description: `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.`,
      inputFormat:
        'First line contains two integers N and target.\nSecond line contains N space-separated integers.',
      outputFormat: 'Print two space-separated indices (0-indexed).',
      constraints: '2 <= N <= 10^4\n-10^9 <= nums[i] <= 10^9\n-10^9 <= target <= 10^9',
      difficulty: 2,
      rating: 1000,
      timeLimit: 2000,
      memoryLimit: 262144,
      tags: ['array', 'hash-map'],
      isPublic: true,
      authorId: admin.id,
      testCases: {
        create: [
          { input: '4 9\n2 7 11 15', expectedOutput: '0 1', isSample: true, orderIndex: 0 },
          { input: '3 6\n3 2 4', expectedOutput: '1 2', isSample: true, orderIndex: 1 },
          { input: '2 6\n3 3', expectedOutput: '0 1', isSample: false, orderIndex: 2 },
          { input: '5 10\n1 2 3 4 6', expectedOutput: '3 4', isSample: false, orderIndex: 3 },
        ],
      },
    },
  })

  console.log('Created problem:', problem1.title)

  const problem2 = await prisma.problem.upsert({
    where: { slug: 'palindrome-check' },
    update: {},
    create: {
      slug: 'palindrome-check',
      title: 'Palindrome Check',
      description: `Given a string s, determine if it is a palindrome.

A palindrome is a string that reads the same forwards and backwards.

Consider only alphanumeric characters and ignore cases.`,
      inputFormat: 'A single line containing the string s.',
      outputFormat: 'Print "YES" if palindrome, "NO" otherwise.',
      constraints: '1 <= |s| <= 10^5\nString contains printable ASCII characters.',
      difficulty: 1,
      rating: 800,
      timeLimit: 1000,
      memoryLimit: 262144,
      tags: ['string', 'two-pointers'],
      isPublic: true,
      authorId: admin.id,
      testCases: {
        create: [
          {
            input: 'A man a plan a canal Panama',
            expectedOutput: 'YES',
            isSample: true,
            orderIndex: 0,
          },
          { input: 'race a car', expectedOutput: 'NO', isSample: true, orderIndex: 1 },
          { input: 'hello', expectedOutput: 'NO', isSample: false, orderIndex: 2 },
          { input: 'abba', expectedOutput: 'YES', isSample: false, orderIndex: 3 },
        ],
      },
    },
  })

  console.log('Created problem:', problem2.title)

  const problem3 = await prisma.problem.upsert({
    where: { slug: 'fibonacci-sequence' },
    update: {},
    create: {
      slug: 'fibonacci-sequence',
      title: 'Fibonacci Number',
      description: `The Fibonacci sequence is defined as:
- F(0) = 0
- F(1) = 1  
- F(n) = F(n-1) + F(n-2) for n > 1

Given n, calculate F(n).`,
      inputFormat: 'A single integer n.',
      outputFormat: 'Print F(n).',
      constraints: '0 <= n <= 30',
      difficulty: 2,
      rating: 900,
      timeLimit: 1000,
      memoryLimit: 262144,
      tags: ['math', 'recursion', 'dynamic-programming'],
      isPublic: true,
      authorId: admin.id,
      testCases: {
        create: [
          { input: '2', expectedOutput: '1', isSample: true, orderIndex: 0 },
          { input: '10', expectedOutput: '55', isSample: true, orderIndex: 1 },
          { input: '0', expectedOutput: '0', isSample: false, orderIndex: 2 },
          { input: '20', expectedOutput: '6765', isSample: false, orderIndex: 3 },
        ],
      },
    },
  })

  console.log('Created problem:', problem3.title)

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(18, 0, 0, 0)

  const endTime = new Date(tomorrow)
  endTime.setHours(20, 0, 0, 0)

  const contest = await prisma.contest.upsert({
    where: { slug: 'weekly-contest-1' },
    update: {},
    create: {
      slug: 'weekly-contest-1',
      title: 'Weekly Contest #1',
      description: 'First weekly contest of CodeForge! Test your skills.',
      startTime: tomorrow,
      endTime,
      isRated: true,
      isPublic: true,
      status: 'SCHEDULED',
      problems: {
        create: [
          { problemId: problem2.id, label: 'A', points: 100 },
          { problemId: problem1.id, label: 'B', points: 200 },
          { problemId: problem3.id, label: 'C', points: 200 },
        ],
      },
    },
  })

  console.log('Created contest:', contest.title)
  console.log('Seed completed!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
