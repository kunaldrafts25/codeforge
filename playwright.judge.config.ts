import { defineConfig } from '@playwright/test'
import config from './playwright.config'
export default defineConfig({ ...config, testMatch: '**/phase2-live.spec.ts', timeout: 300000 })
