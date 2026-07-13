const crypto = require('crypto')

function stableId(prefix, seed) {
  const digest = crypto.createHash('sha256').update(String(seed || '')).digest('hex').slice(0, 24)
  return `${prefix}-${digest}`
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex')
}

module.exports = { stableId, randomToken }
