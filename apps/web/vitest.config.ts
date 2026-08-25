import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@prisma-generated': path.resolve(__dirname, '../../prisma/generated'),
      '@app-builder/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@app-builder/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@app-builder/ai-gateway': path.resolve(__dirname, '../../packages/ai-gateway/src'),
      '@app-builder/codegen': path.resolve(__dirname, '../../packages/codegen/src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    // F-28: include package tests so image-client.test.ts is not orphaned
    include: ['src/**/*.{test,spec}.{ts,tsx}', '../../packages/**/__tests__/**/*.{test,spec}.{ts,tsx}', '../../packages/**/src/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'src/__tests__/'],
    },
  },
});
