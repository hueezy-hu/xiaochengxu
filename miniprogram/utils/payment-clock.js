function createServerOffset(serverNow, clientNow = Date.now()) {
  const server = Number(serverNow)
  const client = Number(clientNow)
  if (!Number.isFinite(server) || !Number.isFinite(client)) return 0
  return server - client
}

function secondsUntil(expiresAt, serverOffset = 0, clientNow = Date.now()) {
  const deadline = Number(expiresAt)
  const current = Number(clientNow) + Number(serverOffset || 0)
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) return 0
  return Math.max(0, Math.ceil((deadline - current) / 1000))
}

function cancelFeedback(response = {}) {
  if (response.ok) return { ok: true, message: '已取消，库存已释放' }
  return { ok: false, message: response.msg || '取消失败，请刷新订单状态' }
}

module.exports = { createServerOffset, secondsUntil, cancelFeedback }
