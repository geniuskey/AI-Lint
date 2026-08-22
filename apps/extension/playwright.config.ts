import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  // 확장은 하나의 브라우저 프로필을 공유한다. 병렬로 돌리면 서로의 설정을 덮어쓴다.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
})
