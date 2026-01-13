const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function testLogin() {
  try {
    console.log('Testing login...')
    
    // Find admin user
    const user = await prisma.user.findUnique({
      where: { email: 'admin@gfgmitadt.in' }
    })
    
    if (!user) {
      console.log('❌ Admin user not found')
      return
    }
    
    console.log('✅ Admin user found:', user.username)
    console.log('✅ User has passwordHash:', !!user.passwordHash)
    
    // Test password comparison
    const isValid = await bcrypt.compare('admin123', user.passwordHash)
    console.log('✅ Password comparison result:', isValid)
    
    if (isValid) {
      console.log('🎉 Login should work!')
    } else {
      console.log('❌ Password comparison failed')
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testLogin()
