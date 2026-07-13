const ORDER_STATUS = Object.freeze({
  RESERVED: '预占中',
  CANCELLED: '已取消',
  EXPIRED: '已超时',
  WAITING_DELIVERY_CONFIRMATION: '待配送确认',
  WAITING_PICKUP: '待自提',
  REFUNDING: '退款处理中',
  REFUND_FAILED: '退款失败',
  REFUNDED: '已退款',
  PLACED: '已放置待自取',
  COMPLETED: '已完成'
})

const BADGE_STATUSES = new Set([
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.WAITING_DELIVERY_CONFIRMATION,
  ORDER_STATUS.WAITING_PICKUP,
  ORDER_STATUS.REFUND_FAILED
])

function canCancelPending(status) {
  return status === ORDER_STATUS.RESERVED
}

function canRequestRefund(status) {
  return [ORDER_STATUS.WAITING_DELIVERY_CONFIRMATION, ORDER_STATUS.WAITING_PICKUP].includes(status)
}

function showsPickupTicket(status) {
  return [ORDER_STATUS.WAITING_PICKUP, ORDER_STATUS.PLACED].includes(status)
}

function countsForBadge(status) {
  return BADGE_STATUSES.has(status)
}

module.exports = {
  ORDER_STATUS,
  canCancelPending,
  canRequestRefund,
  showsPickupTicket,
  countsForBadge
}
