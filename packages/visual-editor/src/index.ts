// Visual Editor Vite plugin — injects stable IDs into JSX elements at build time
// Enables click-to-select in the visual editor by mapping DOM elements back to source AST nodes.

export { visualEditorPlugin } from './plugin';
export type { VisualEditorOptions, StableIdMap } from './types';
