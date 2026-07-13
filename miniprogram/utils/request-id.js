function createRequestId(prefix = 'req') {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${random}`
}

module.exports = { createRequestId }
