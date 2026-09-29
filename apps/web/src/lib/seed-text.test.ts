import { describe, expect, it } from 'vitest';
import { seedAppTsx, seedPlainText } from './seed-text';

describe('seedAppTsx', () => {
  it('keeps a normal brief readable', () => {
    expect(seedPlainText('Build a CRM for a small team.')).toBe('Build a CRM for a small team.');
  });

  it('does not let a brief break the generated component', () => {
    const source = seedAppTsx('`Acme`', 'Use ${user} and {id}\nnext <b>bold</b> & more');
    expect(source).not.toContain('`');
    expect(source).not.toContain('${');
    expect(source).not.toContain('<b>');
    expect(source).not.toContain('{id}');
    expect(source).toContain('&amp;');
    expect(source).toContain('&#123;id&#125;');
    expect(source).toContain(
      'Use $&#123;user&#125; and &#123;id&#125; next &lt;b&gt;bold&lt;/b&gt; &amp; more',
    );
    expect(source.startsWith('export default function App()')).toBe(true);
  });
});
