// Response Parser — legacy markdown parser (kept for backward compatibility)
// The new engine uses parseResponse() in engine.ts for structured JSON output.

import type { FileChange, FileOperation } from './types';

interface ParsedBlock {
  path: string;
  language: string;
  content: string;
}

/**
 * Legacy parser: extracts fenced code blocks from markdown AI responses.
 * The production pipeline now uses structured JSON via parseResponse().
 */
export class ResponseParser {
  parse(rawResponse: string): {
    message: string;
    changes: FileChange[];
  } {
    const blocks = this.extractCodeBlocks(rawResponse);
    const message = this.extractMessage(rawResponse);

    const changes: FileChange[] = blocks.map((block) => ({
      path: block.path,
      operation: 'CREATE' as FileOperation,
      content: block.content,
    }));

    return { message, changes };
  }

  private extractCodeBlocks(text: string): ParsedBlock[] {
    const blocks: ParsedBlock[] = [];
    const regex = /```(\w+)?\s*(?:path=([^\s]+))?\s*\n([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const language = match[1] ?? 'text';
      const path = match[2] ?? this.inferPath(language);
      const content = match[3]?.trim() ?? '';

      if (content) {
        blocks.push({ path, language, content });
      }
    }

    return blocks;
  }

  private extractMessage(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '').trim();
  }

  private inferPath(language: string): string {
    const extMap: Record<string, string> = {
      tsx: 'src/App.tsx',
      ts: 'src/utils.ts',
      jsx: 'src/App.jsx',
      js: 'src/utils.js',
      css: 'src/styles.css',
      json: 'package.json',
      html: 'index.html',
    };
    return extMap[language] ?? `src/file.${language}`;
  }
}
