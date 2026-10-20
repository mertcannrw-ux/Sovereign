/** Up to two initials: "Ada Lovelace" -> "AL", "ada@x.dev" -> "A". */
export function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0] ?? 'U';
  const last = words.at(-1) ?? '';
  if (name.includes('@') || words.length < 2) return first.charAt(0).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}
