// Vite Plugin for Visual Editor — injects stable unique IDs into JSX elements

import type { Plugin } from 'vite';
import type { VisualEditorOptions } from './types';

/**
 * A Vite plugin that injects `data-ve-id` attributes into JSX elements at build time.
 * This enables click-to-select in the visual editor by mapping DOM elements
 * back to their source AST nodes.
 *
 * The plugin uses a simple regex-based approach for ID injection.
 * In production, this would use Babel/SWC AST transforms for accuracy.
 */
export function visualEditorPlugin(options: VisualEditorOptions = {}): Plugin {
  const {
    enabled = process.env.NODE_ENV === 'development',
    idPrefix = 've',
    idAttribute = 'data-ve-id',
  } = options;

  let counter = 0;

  return {
    name: 'visual-editor-plugin',
    enforce: 'pre',

    transform(code: string, id: string) {
      if (!enabled) return null;
      if (!id.match(/\.(tsx|jsx)$/)) return null;

      const fileName = id.split('/').pop() || id;

      // Inject stable IDs into JSX elements
      // This is a simplified approach — a production implementation would use
      // Babel/SWC AST transforms for precise node-level injection.
      const transformed = injectStableIds(code, fileName, idPrefix, idAttribute, () => ++counter);

      if (transformed === code) return null;

      return {
        code: transformed,
        map: null,
      };
    },
  };
}

/**
 * Inject stable data-ve-id attributes into JSX opening tags.
 */
function injectStableIds(
  code: string,
  fileName: string,
  prefix: string,
  attr: string,
  nextId: () => number,
): string {
  const lines = code.split('\n');
  const result: string[] = [];

  // Only inject into lines that look like JSX elements
  // Avoid: imports, exports, comments, strings
  const jsxTagRegex = /<\s*([A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9-]*)\b/;
  const alreadyHasId = new RegExp(`\\s${attr}=`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line && jsxTagRegex.test(line) && !alreadyHasId.test(line)) {
      const id = `${prefix}-${fileName.replace(/\.\w+$/, '')}-${nextId()}`;
      // Inject the attribute before the first `>` or `/>`
      const injected = line.replace(
        /(\s*)(\/?>)/,
        (match, spaces, closer) => ` ${attr}="${id}"${closer}`,
      );
      result.push(injected);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}
