export type WorkspaceChange = { entities?: string[] };
export function affects(event: Event, entities: string[]) {
  const changed = (event as CustomEvent<WorkspaceChange>).detail?.entities;
  return !changed || entities.some((entity) => changed.includes(entity));
}
export function announceChange(entities?: string[]) {
  window.dispatchEvent(
    new CustomEvent<WorkspaceChange>("lifeos:changed", {
      detail: { entities },
    }),
  );
}
export function mergeConfirmed<T extends { id: string; version?: number }>(
  rows: T[],
  record: T,
) {
  const old = rows.find((r) => r.id === record.id);
  if (old && (old.version ?? 0) > (record.version ?? 0)) return rows;
  return old
    ? rows.map((r) => (r.id === record.id ? record : r))
    : [...rows, record];
}

/** Read replicas and slow navigation responses must not erase a confirmed version. */
export function keepConfirmedRows<T extends Record<string, unknown>>(
  incoming: T,
  current: T,
  confirmed: Map<string, number>,
): T {
  const merged = { ...incoming };
  for (const [entity, rows] of Object.entries(current)) {
    if (!Array.isArray(rows) || !Array.isArray(incoming[entity])) continue;
    let next = incoming[entity] as { id: string; version?: number }[];
    for (const row of rows as { id: string; version?: number }[]) {
      const floor = confirmed.get(entity + ":" + row.id);
      if (floor !== undefined && (row.version ?? 0) >= floor)
        next = mergeConfirmed(next, row);
    }
    (merged as Record<string, unknown>)[entity] = next;
  }
  return merged;
}

/** A read can acknowledge only the exact save/version it was issued to verify. */
export function clearVerifiedRead<T extends { version: number }>(
  pending: Map<string, T>,
  key: string,
  expected: T,
  record: { version?: number },
) {
  if (
    pending.get(key) === expected &&
    (record.version ?? 0) >= expected.version
  )
    pending.delete(key);
}
