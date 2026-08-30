import { describe, expect, it } from 'vitest';
import { FALLBACK_EXPORT, resolveLucideExport, rewriteLucideSource } from './lucide-map';

describe('resolveLucideExport', () => {
  it('keeps lucide-react@0.487.0 canonical exports', () => {
    expect(resolveLucideExport('House')).toBe('House');
    expect(resolveLucideExport('Cat')).toBe('Cat');
    expect(resolveLucideExport('Apple')).toBe('Apple');
    expect(resolveLucideExport('FileJson')).toBe('FileJson');
    expect(resolveLucideExport('Sparkle')).toBe('Sparkle');
    expect(resolveLucideExport('Bot')).toBe('Bot');
    expect(resolveLucideExport('Search')).toBe('Search');
    expect(resolveLucideExport('Circle')).toBe('Circle');
    expect(resolveLucideExport('createLucideIcon')).toBe('createLucideIcon');
  });

  it('maps 0.487.0 aliases to canonical names', () => {
    expect(resolveLucideExport('Home')).toBe('House');
    expect(resolveLucideExport('HomeIcon')).toBe('House');
    expect(resolveLucideExport('HelpCircle')).toBe('CircleHelp');
    expect(resolveLucideExport('Loader2')).toBe('LoaderCircle');
    expect(resolveLucideExport('Edit')).toBe('SquarePen');
    expect(resolveLucideExport('Filter')).toBe('Funnel');
    expect(resolveLucideExport('AlertCircle')).toBe('CircleAlert');
    expect(resolveLucideExport('Verified')).toBe('BadgeCheck');
  });

  it('maps common icon suffixes and heroicon aliases', () => {
    expect(resolveLucideExport('MagnifyingGlassIcon')).toBe('Search');
    expect(resolveLucideExport('Bars3Icon')).toBe('Menu');
    expect(resolveLucideExport('XMarkIcon')).toBe('X');
    expect(resolveLucideExport('LucideSettings')).toBe('Settings');
  });

  it('never rewrites type/runtime helpers', () => {
    expect(resolveLucideExport('LucideIcon')).toBe('LucideIcon');
    expect(resolveLucideExport('LucideProps')).toBe('LucideProps');
    expect(resolveLucideExport('icons')).toBe('icons');
  });

  it('falls back to Circle for unknown icons', () => {
    expect(resolveLucideExport('NotARealIcon')).toBe(FALLBACK_EXPORT);
    expect(resolveLucideExport('FooBar')).toBe(FALLBACK_EXPORT);
  });
});

describe('rewriteLucideSource', () => {
  it('aliases remapped exports so local JSX and value uses stay valid', () => {
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
    expect(result.source).toContain(
      "import { House as HomeIcon, Search as MagnifyingGlassIcon, Circle as GhostWidget } from 'lucide-react'",
    );
    expect(result.source).toContain('<HomeIcon />');
    expect(result.source).toContain('<MagnifyingGlassIcon />');
    expect(result.source).toContain('<GhostWidget />');
  });

  it('keeps 0.487 alias locals for non-JSX value uses like nav icon maps', () => {
    const source = `import { Home, Search, Edit, Filter, HelpCircle, Loader2 } from 'lucide-react';
const NAV = [{ href: '/', icon: Home }, { href: '/search', icon: Search }];
export const App = () => <Home />;
export const Spinner = () => <Loader2 />;
export const Toolbar = () => <><Edit /><Filter /><HelpCircle /></>;
`;
    const result = rewriteLucideSource(source);
    expect(result.source).toContain(
      "import { House as Home, Search, SquarePen as Edit, Funnel as Filter, CircleHelp as HelpCircle, LoaderCircle as Loader2 } from 'lucide-react'",
    );
    expect(result.source).toContain('icon: Home');
    expect(result.source).toContain('icon: Search');
    expect(result.source).toContain('<Home />');
    expect(result.source).toContain('<Loader2 />');
    expect(result.source).toContain('<Edit />');
    expect(result.source).toContain('<Filter />');
    expect(result.source).toContain('<HelpCircle />');
  });

  it('does not rewrite real 0.487 exports to Circle or smash object keys', () => {
    const source = `import { Cat, FileJson, House } from 'lucide-react';
const animals = { Cat };
export const Icon = () => <Cat />;
export const File = () => <FileJson />;
export const Home = () => <House />;
`;
    const result = rewriteLucideSource(source);
    expect(result.source).toContain('{ Cat, FileJson, House }');
    expect(result.source).toContain('const animals = { Cat }');
    expect(result.source).toContain('<Cat />');
    expect(result.source).toContain('<FileJson />');
    expect(result.source).toContain('<House />');
  });

  it('preserves type specifiers and createLucideIcon', () => {
    const source = `import { type LucideIcon, type LucideProps, createLucideIcon } from 'lucide-react';
export type Props = LucideProps;
export const Heart: LucideIcon = createLucideIcon('Heart', []);
`;
    const result = rewriteLucideSource(source);
    expect(result.source).toContain('type LucideIcon');
    expect(result.source).toContain('type LucideProps');
    expect(result.source).toContain('createLucideIcon');
    expect(result.source).not.toContain('Circle');
  });

  it('preserves local aliases', () => {
    const source = `import { SearchIcon as Magnifier } from "lucide-react";
export const Icon = () => <Magnifier />;
`;
    const result = rewriteLucideSource(source);
    expect(result.source).toContain('Search as Magnifier');
    expect(result.source).toContain('<Magnifier />');
  });

  it('aliases a default lucide import without renaming other Icon identifiers', () => {
    const source = `import Icon from 'lucide-react';
interface Icon { name: string }
export const Mark = () => <Icon />;
`;
    const result = rewriteLucideSource(source);
    expect(result.source).toContain("import { Circle as Icon } from 'lucide-react'");
    expect(result.source).toContain('<Icon />');
    expect(result.source).toContain('interface Icon');
  });

  it('leaves files without lucide-react imports alone', () => {
    const source = `export const n = 1;`;
    expect(rewriteLucideSource(source)).toEqual({ source, changed: false });
  });
});
