export function reconcileOptimisticItems<T extends { id: string }>(
  current: T[],
  optimisticId: string,
  completed: T[],
): T[] {
  const replacedIds = new Set([optimisticId, ...completed.map((item) => item.id)]);
  return [...current.filter((item) => !replacedIds.has(item.id)), ...completed];
}
