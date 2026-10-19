import { createLucideIcon } from 'lucide-react';

/**
 * Lucide's `key` with a four-point spark in its free corner: "your own AI
 * keys". Drawn on Lucide's 24px grid so it sits beside stock icons; the spark
 * is filled because a stroked one closes up at 16px.
 */
export const AIKey = createLucideIcon('ai-key', [
  ['circle', { cx: '7.5', cy: '16', r: '5.5', key: 'head' }],
  ['path', { d: 'm21 2.5-9.6 9.6', key: 'shaft' }],
  [
    'path',
    {
      d: 'm15.5 8 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4.5',
      key: 'bit',
    },
  ],
  [
    'path',
    {
      d: 'M5 .75Q5.8 3.7 8.75 4.5 5.8 5.3 5 8.25 4.2 5.3 1.25 4.5 4.2 3.7 5 .75Z',
      fill: 'currentColor',
      strokeWidth: '1',
      key: 'spark',
    },
  ],
]);
