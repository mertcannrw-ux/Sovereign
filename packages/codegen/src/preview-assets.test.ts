import { describe, expect, it } from 'vitest';
import { getPreviewAssetUrls, replacePreviewAssetUrls } from './preview-assets';

describe('preview asset URL helpers', () => {
  it('deduplicates local asset URLs and replaces only provided mappings', () => {
    const first = 'http://localhost:3000/api/assets/projects/p/a.png?expires=1&sig=abc';
    const second = 'http://localhost:3000/api/assets/projects/p/b.webp?expires=2&sig=def';
    const content = `<img src="${first}" /><div style="background-image:url(${second})"></div><img src="${first}" />`;

    expect(getPreviewAssetUrls(content)).toEqual([first, second]);
    expect(
      replacePreviewAssetUrls(
        content,
        new Map([
          [first, '/__sovereign_assets/a.png'],
          [second, '/__sovereign_assets/b.webp'],
        ]),
      ),
    ).toBe(
      '<img src="/__sovereign_assets/a.png" /><div style="background-image:url(/__sovereign_assets/b.webp)"></div><img src="/__sovereign_assets/a.png" />',
    );
  });
});
