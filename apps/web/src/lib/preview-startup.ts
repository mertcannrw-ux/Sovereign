export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface PreviewSourceFile {
  path: string;
  content: string;
}

const PREVIEW_ASSET_URL_PATTERN = /https?:\/\/[^'"`\s),\]]+\/api\/assets\/[^'"`\s),\]]+/g;

/** Finds local builder asset URLs that cannot be fetched from an HTTPS preview iframe. */
export function getPreviewAssetUrls(content: string): string[] {
  return [...new Set(content.match(PREVIEW_ASSET_URL_PATTERN) ?? [])];
}

/** Replaces only URLs that were successfully materialized into the preview filesystem. */
export function replacePreviewAssetUrls(
  content: string,
  replacements: ReadonlyMap<string, string>,
): string {
  let result = content;
  for (const [source, target] of replacements) {
    result = result.split(source).join(target);
  }
  return result;
}

/** Merges boot layers while preserving the first (project-owned) file at each path. */
export function mergePreviewFiles(...groups: PreviewSourceFile[][]): PreviewSourceFile[] {
  const files = new Map<string, PreviewSourceFile>();
  for (const group of groups) {
    for (const file of group) {
      if (!files.has(file.path)) files.set(file.path, file);
    }
  }
  return [...files.values()];
}

export function getPreviewSupportFiles(files: PreviewSourceFile[]): PreviewSourceFile[] {
  const paths = new Set(files.map((file) => file.path.toLowerCase()));
  const hasReactTypescript = files.some((file) => /\.tsx$/i.test(file.path));
  const hasTypeScriptConfig = [...paths].some((path) =>
    /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(path),
  );

  if (!hasReactTypescript || hasTypeScriptConfig) return [];
  return [
    {
      path: 'tsconfig.json',
      content: JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }, null, 2),
    },
  ];
}
