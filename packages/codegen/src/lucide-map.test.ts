import { describe, expect, it } from 'vitest';
import { FALLBACK_EXPORT, resolveLucideExport, rewriteLucideSource } from './lucide-map';

describe('resolveLucideExport', () => {
  it('keeps valid lucide named exports', () => {
    expect(resolveLucideExport('Home')).toBe('Home');
    expect(resolveLucideExport('Search')).toBe('Search');
    expect(resolveLucideExport('Circle')).toBe('Circle');
  });

  it('maps common icon suffixes and heroicon aliases', () => {
    expect(resolveLucideExport('HomeIcon')).toBe('Home');
    expect(resolveLucideExport('MagnifyingGlassIcon')).toBe('Search');
    expect(resolveLucideExport('Bars3Icon')).toBe('Menu');
    expect(resolveLucideExport('XMarkIcon')).toBe('X');
    expect(resolveLucideExport('LucideSettings')).toBe('Settings');
  });

  it('falls back to Circle for unknown icons', () => {
    expect(resolveLucideExport('NotARealIcon')).toBe(FALLBACK_EXPORT);
    expect(resolveLucideExport('FooBar')).toBe(FALLBACK_EXPORT);
  });
});

describe('rewriteLucideSource', () => {
  it('rewrites invalid named imports and matching JSX', () => {
    const source = `import { HomeIcon, MagnifyingGlassIcon, GhostWidget } from 'lucide-react';

export function Header() {
  return (
    <div>
      <HomeIcon />
      <MagnifyingGlassIcon />
      <GhostWidget />
    </div>
  );
}
`;
    const result = rewriteLucideSource(source);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("import { Home, Search, Circle } from 'lucide-react'");
    expect(result.source).toContain('<Home />');
    expect(result.source).toContain('<Search />');
    expect(result.source).toContain('<Circle />');
    expect(result.source).not.toContain('HomeIcon');
    expect(result.source).not.toContain('GhostWidget');
  });

  it('preserves local aliases', () => {
    const source = `import { SearchIcon as Magnifier } from "lucide-react";
export const Icon = () => <Magnifier />;
`;
    const result = rewriteLucideSource(source);
    expect(result.source).toContain('Search as Magnifier');
    expect(result.source).toContain('<Magnifier />');
  });

  it('converts a default lucide import to Circle', () => {
    const source = `import Icon from 'lucide-react';
export const Mark = () => <Icon />;
`;
    const result = rewriteLucideSource(source);
    expect(result.source).toContain("import { Circle } from 'lucide-react'");
    expect(result.source).toContain('<Circle />');
    expect(result.source).not.toMatch(/\bIcon\b/);
  });

  it('leaves files without lucide-react imports alone', () => {
    const source = `export const n = 1;`;
    expect(rewriteLucideSource(source)).toEqual({ source, changed: false });
  });
});
