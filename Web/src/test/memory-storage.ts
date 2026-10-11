/** Stockage en mémoire partageable entre deux « onglets » simulés. */
export function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

/** Verrou exclusif minimal (API Web Locks) : les callbacks passent l'un après l'autre. */
export function memoryLocks(): Pick<LockManager, 'request'> {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    request: ((_name: string, cb: () => Promise<unknown>) => {
      const run = tail.then(() => cb())
      tail = run.catch(() => undefined)
      return run
    }) as LockManager['request'],
  }
}
