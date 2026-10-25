export function createAsyncResourceGuard() {
  const latest = new Map()
  return {
    begin(key, source, scope) {
      const ticket = { key, source, scope }
      latest.set(key, ticket)
      return ticket
    },
    isCurrent(ticket, source, scope) {
      return !!ticket && latest.get(ticket.key) === ticket && ticket.source === source && ticket.scope === scope
    },
    invalidate(key) { latest.delete(key) },
    invalidateAll() { latest.clear() },
    prune(keep) {
      for (const key of latest.keys()) if (!keep(key)) latest.delete(key)
    }
  }
}
