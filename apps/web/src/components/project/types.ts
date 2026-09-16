export interface SelectedPreviewElement {
  tagName: string;
  id: string | null;
  className: string;
  text: string;
  selector: string;
  sourceFile: string;
  veId?: string | null;
  outerHTML: string;
}

export interface ModelGroup {
  provider: string;
  label: string;
  models: string[];
}
