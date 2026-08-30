/**
 * Cheap JSON repair for generated package.json / tsconfig.json.
 * Handles comments, trailing commas, and truncated objects/arrays/strings.
 * Not a general-purpose JSON5 parser.
 */

export function repairJson(text: string): unknown | null {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  const sanitized = sanitizeJsonText(trimmed);
  try {
    return JSON.parse(sanitized);
  } catch {
    return null;
  }
}

export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sanitizeJsonText(input: string): string {
  const withoutComments = stripComments(input);
  const closed = closeTruncated(stripTrailingCommas(withoutComments));
  return closed.trim();
}

function stripComments(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && input[i + 1] === '/') {
      i += 1;
      while (i + 1 < input.length && input[i + 1] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j]!)) j += 1;
      if (input[j] === '}' || input[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

function closeTruncated(input: string): string {
  let inString = false;
  let escaped = false;
  const stack: Array<'{' | '['> = [];
  let awaitingValue = false;

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      awaitingValue = false;
      continue;
    }
    if (c === '{') {
      stack.push('{');
      awaitingValue = false;
      continue;
    }
    if (c === '[') {
      stack.push('[');
      awaitingValue = false;
      continue;
    }
    if (c === '}' || c === ']') {
      stack.pop();
      awaitingValue = false;
      continue;
    }
    if (c === ':') {
      awaitingValue = true;
      continue;
    }
    if (c === ',') {
      awaitingValue = stack[stack.length - 1] === '{';
      continue;
    }
    if (!/\s/.test(c)) awaitingValue = false;
  }

  let out = input;
  if (inString) {
    if (escaped) out += '\\';
    out += '"';
  }
  if (awaitingValue) out += 'null';

  for (let i = stack.length - 1; i >= 0; i -= 1) {
    out += stack[i] === '{' ? '}' : ']';
  }
  return out;
}
