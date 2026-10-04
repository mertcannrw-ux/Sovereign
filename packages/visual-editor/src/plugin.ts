// Vite Plugin for Visual Editor - injects stable unique IDs into JSX elements
import type { Plugin } from 'vite';
import type { VisualEditorOptions } from './types';
import ts from 'typescript';

/**
 * A Vite plugin that injects data-ve-id attributes into JSX elements at build time.
 * This enables click-to-select in the visual editor by mapping DOM elements
 * back to their source AST nodes.
 *
 * Implementation notes (regression N-3):
 * The earlier line-by-line regex approach corrupted JavaScript that used `<`/`>`
 * as comparison or generic operators (e.g. `const x = a < b && c > d;` or
 * `const arr: Array<number>`), because it matched the operator as if it were a
 * JSX tag. We now run a real AST pass with the TypeScript compiler API and only
 * inject into genuine `JSXOpeningElement` nodes, so ordinary TS/JS is never
 * altered. A cheap regex pre-check skips files with no JSX at all.
 */
export function visualEditorPlugin(options: VisualEditorOptions = {}): Plugin {
  const {
    enabled = process.env.NODE_ENV === 'development',
    idPrefix = 've',
    idAttribute = 'data-ve-id',
  } = options;

  return {
    name: 'visual-editor-plugin',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!enabled) return null;
      if (!id.match(/\.(tsx|jsx)$/)) return null;
      // Fast-path: skip files with no JSX opening tags or fragments at all.
      if (!/<\/?[A-Za-z]/.test(code) && !code.includes('<>')) return null;

      const fileName = id.split('/').pop() || id;
      let localCounter = 0;
      const transformed = injectStableIds(
        code,
        fileName,
        idPrefix,
        idAttribute,
        () => ++localCounter,
      );
      if (transformed === code) return null;
      return {
        code: transformed,
        map: null,
      };
    },
  };
}

function injectStableIds(
  code: string,
  fileName: string,
  prefix: string,
  attr: string,
  nextId: () => number,
): string {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
  } catch {
    return code;
  }

  const edits: { pos: number; end: number; replacement: string }[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node)) {
      // Never double-inject if the attribute already exists.
      const alreadyHas = node.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === attr,
      );
      if (!alreadyHas) {
        const id = `${prefix}-${fileName.replace(/\.\w+$/, '')}-${nextId()}`;
        const attrText = ` ${attr}="${id}"`;
        // Insert the new attribute right after the tag name (e.g. `<div▸ ...>`),
        // which works for both self-closing and paired opening elements and
        // never touches operator characters.
        const insertPos = node.tagName.getEnd();
        edits.push({ pos: insertPos, end: insertPos, replacement: attrText });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (edits.length === 0) return code;

  // Apply edits from right to left so earlier positions stay valid.
  let result = code;
  for (const e of edits.sort((a, b) => b.pos - a.pos)) {
    result = result.slice(0, e.pos) + e.replacement + result.slice(e.end);
  }
  return result;
}
