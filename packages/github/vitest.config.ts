import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'src',
  test: {
    environment: 'node',
    include: ['scaffold.test.ts', 'writeback.test.ts', '__tests__/scaffold.test.ts'],
  },
});
