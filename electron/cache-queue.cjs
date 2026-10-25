function createPriorityQueue(concurrency = 2) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Cache queue concurrency must be a positive integer.')
  const queue = []
  let active = 0
  let sequence = 0

  function pump() {
    while (active < concurrency && queue.length) {
      const item = queue.shift()
      active++
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
        active--
        pump()
      })
    }
  }

  function sort() { queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence) }

  function enqueue(task, { priority = 0, sourceKey = '' } = {}) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject, priority, sourceKey, sequence: sequence++ })
      sort()
      pump()
    })
  }

  function prioritize(sourceKey) {
    for (const item of queue) item.priority = item.sourceKey === sourceKey ? 100 : 0
    sort()
  }

  return { enqueue, prioritize }
}

module.exports = { createPriorityQueue }
