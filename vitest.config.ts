import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@testing-library/react': path.resolve(__dirname, 'tests/testing-library.tsx'),
      '@testing-library/react-impl': path.resolve(
        __dirname,
        'node_modules/@testing-library/react',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // e2e 是 Playwright 的地盘（npm run test:e2e），vitest 不碰
    exclude: ['e2e/**', 'node_modules/**'],
    css: false,
  },
});
