/** Spacing between neighbouring cards in the dashboard's manual order. */
export const PROJECT_SORT_GAP = 1000;
/** Below this gap, cards are renumbered instead of squeezed further together. */
const MIN_SORT_GAP = 1e-6;

type OrderedProject = { id: string; sortOrder: number };

/**
 * The Realm's order after dropping `movedId` between its new neighbours, and
 * the fractional sortOrder that realizes it. `position` is null when the
 * neighbours leave no usable float gap (or the slot would land at or below
 * zero, where newly created projects sit), so the caller renumbers instead.
 * `ordered` must already be in display order.
 */
export function moveProject<T extends OrderedProject>(
  ordered: T[],
  movedId: string,
  previousId: string | null,
  nextId: string | null,
): { order: T[]; position: number | null } {
  const moved = ordered.find((row) => row.id === movedId);
  if (!moved) return { order: ordered, position: null };
  const others = ordered.filter((row) => row.id !== movedId);
  const previousIndex = previousId ? others.findIndex((row) => row.id === previousId) : -1;
  const nextIndex = nextId ? others.findIndex((row) => row.id === nextId) : -1;
  // Prefer "after the previous card"; a stale neighbour id falls back to
  // "before the next card", then to the start.
  const insertAt = previousIndex >= 0 ? previousIndex + 1 : nextIndex >= 0 ? nextIndex : 0;
  const order = [...others.slice(0, insertAt), moved, ...others.slice(insertAt)];
  const previous = insertAt > 0 ? others[insertAt - 1] : null;
  const next = insertAt < others.length ? others[insertAt] : null;

  if (!previous && !next) return { order, position: 0 };
  if (!previous) {
    const position = next!.sortOrder - PROJECT_SORT_GAP;
    return { order, position: position > 0 ? position : null };
  }
  if (!next) return { order, position: previous.sortOrder + PROJECT_SORT_GAP };
  const gap = next.sortOrder - previous.sortOrder;
  return {
    order,
    position: gap > MIN_SORT_GAP ? previous.sortOrder + gap / 2 : null,
  };
}
