/**
 * Text interpolated into a JSX text node from a JS template literal.
 * A template brief is free text; braces, backticks, markup, or newlines
 * would otherwise break the generated `src/App.tsx` or this literal.
 */
export function seedPlainText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Starter `src/App.tsx` for a project created from a template brief. */
export function seedAppTsx(name: string, description: string): string {
  const safeName = seedPlainText(name);
  const safeDescription = seedPlainText(description);
  return `export default function App() {\n  return (\n    <main>\n      <h1>${safeName}</h1>\n      <p>${safeDescription}</p>\n    </main>\n  );\n}\n`;
}
