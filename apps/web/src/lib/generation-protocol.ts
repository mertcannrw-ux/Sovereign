/**
 * Shapes shared by the generation pipeline.
 *
 * The `<<<FILE:…>>>` dialect these types were first written for is retired
 * (`docs/agent-runtime.md`); only the two types still cross module boundaries.
 */

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ClarifyingQuestion {
  question: string;
  options: [string, string, string];
}
