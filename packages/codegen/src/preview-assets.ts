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
