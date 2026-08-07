// Types for the Visual Editor Vite plugin

export interface VisualEditorOptions {
  /** Whether to inject stable IDs (default: true in dev, false in prod) */
  enabled?: boolean;
  /** Prefix for generated stable IDs */
  idPrefix?: string;
  /** Custom ID attribute name */
  idAttribute?: string;
}

export interface StableIdMap {
  /** Maps stable element IDs to source file + line number */
  [stableId: string]: {
    file: string;
    line: number;
    column: number;
    elementType: string;
  };
}

export interface ElementMetadata {
  stableId: string;
  file: string;
  line: number;
  elementType: string;
  tailwindClasses: string[];
  children: ElementMetadata[];
}
