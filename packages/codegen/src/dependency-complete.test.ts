import { describe, expect, it } from 'vitest';
import { completePackageJson } from './dependency-complete';
import stackLock from './stack-lock.json';

describe('completePackageJson', () => {
  it('seeds a full Vite + React 19 package.json when missing', () => {
    const result = completePackageJson(undefined);
    expect(result.seeded).toBe(true);
    const pkg = JSON.parse(result.json) as Record<string, unknown>;
    expect(pkg).toMatchObject({
      name: 'generated-app',
      private: true,
      type: 'module',
      scripts: stackLock.scripts,
      dependencies: stackLock.dependencies,
      devDependencies: stackLock.devDependencies,
    });
  });

  it('repairs truncated JSON then pins stack-lock versions', () => {
    const result = completePackageJson('{"name":"shop","dependencies":{"react":"^18.2.0",}');
    expect(result.repaired).toBe(true);
    expect(result.completed).toBe(true);
    const pkg = JSON.parse(result.json) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies.react).toBe(stackLock.dependencies.react);
    expect(pkg.dependencies['react-dom']).toBe(stackLock.dependencies['react-dom']);
    expect(pkg.devDependencies.vite).toBe(stackLock.devDependencies.vite);
    expect(pkg.devDependencies.typescript).toBe(stackLock.devDependencies.typescript);
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
  });

  it('preserves extra dependencies and extra scripts', () => {
    const result = completePackageJson(
      JSON.stringify({
        name: 'shop',
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { test: 'vitest' },
        dependencies: { clsx: '2.1.1' },
      }),
    );
    const pkg = JSON.parse(result.json) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(pkg.scripts.test).toBe('vitest');
    expect(pkg.dependencies.clsx).toBe('2.1.1');
    expect(pkg.dependencies.react).toBe(stackLock.dependencies.react);
  });

  it('adds lucide-react from the lockfile when requested', () => {
    const result = completePackageJson('{"name":"app"}', {
      extraDependencies: stackLock.conditionalDependencies,
    });
    const pkg = JSON.parse(result.json) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['lucide-react']).toBe(stackLock.conditionalDependencies['lucide-react']);
  });
});
