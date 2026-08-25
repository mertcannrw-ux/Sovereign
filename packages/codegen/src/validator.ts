// AST Validator — validates generated TypeScript/TSX/CSS code

import type { FileChange, Diagnostic } from './types';

/**
 * Validates generated code files before applying them to a project.
 */
export class ASTValidator {
  /**
   * Validate an array of file changes.
   */
  validate(files: FileChange[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const file of files) {
      if (file.content === undefined) continue; // deletes don't need validation
      this.validateFile(file, diagnostics);
    }

    return diagnostics;
  }

  private validateFile(file: FileChange, diagnostics: Diagnostic[]): void {
    const ext = file.path.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'ts':
      case 'tsx':
        this.validateTypeScript(file.content ?? '', file.path, diagnostics);
        break;
      case 'js':
      case 'jsx':
        this.validateJavaScript(file.content ?? '', file.path, diagnostics);
        break;
      case 'css':
        this.validateCSS(file.content ?? '', file.path, diagnostics);
        break;
      case 'json':
        this.validateJSON(file.content ?? '', file.path, diagnostics);
        break;
    }
  }

  private validateTypeScript(content: string, path: string, diagnostics: Diagnostic[]): void {
    // Basic checks — full validation happens at build time
    if (/\beval\s*\(/.test(content)) {
      diagnostics.push({
        file: path,
        severity: 'warning',
        message: 'Contains eval() — may be a security risk',
      });
    }

    if (content.includes('process.env') && !path.includes('.env')) {
      diagnostics.push({
        file: path,
        severity: 'warning',
        message: 'Direct process.env access — consider using env.ts',
      });
    }
  }

  private validateJavaScript(content: string, path: string, diagnostics: Diagnostic[]): void {
    this.validateTypeScript(content, path, diagnostics);
  }

  private validateCSS(content: string, path: string, diagnostics: Diagnostic[]): void {
    if (content.includes('@import') && content.includes('url(')) {
      diagnostics.push({
        file: path,
        severity: 'info',
        message: 'CSS imports with url() — ensure paths are correct',
      });
    }
  }

  private validateJSON(content: string, path: string, diagnostics: Diagnostic[]): void {
    try {
      JSON.parse(content);
    } catch (e) {
      diagnostics.push({
        file: path,
        severity: 'error',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`,
      });
    }
  }
}
