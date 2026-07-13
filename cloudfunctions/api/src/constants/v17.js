const STATION_THRESHOLD = 5
const RESERVATION_TTL_MS = 3 * 60 * 1000

const VERIFY_MODES = Object.freeze({
  STAFF: '有人核销',
  UNATTENDED: '无人放置'
})

const BATCH_STATUS = Object.freeze({
  DRAFT: '草稿',
  ACCEPTING: '接单中',
  WAITING_CONFIRMATION: '已截单待配送确认',
  DELIVERING: '配送进行中',
  CLOSING: '关闭退款中',
  ENDED: '已结束'
})

const STATION_STATUS = Object.freeze({
  GROUPING: '拼团中',
  FORMED: '已成团待确认',
  UNFORMED: '未成团待处理',
  DELIVERY_CONFIRMED: '已确认配送',
  CLOSING: '关闭退款中',
  CLOSED: '已关闭',
  PICKUP_ACTIVE: '自提进行中',
  COMPLETED: '已完成'
})

const ORDER_STATUS = Object.freeze({
  RESERVED: '预占中',
  CANCELLED: '已取消',
  EXPIRED: '已超时',
  WAITING_DELIVERY: '待配送确认',
  WAITING_PICKUP: '待自提',
  REFUND_REQUESTED: '退款申请待处理',
  REFUNDING: '退款处理中',
  REFUNDED: '已退款',
  PLACED: '已放置待自取',
  COMPLETED: '已完成',
  COMPLETED_NO_SHOW: '已完成未取'
})

module.exports = {
  STATION_THRESHOLD,
  RESERVATION_TTL_MS,
  VERIFY_MODES,
  BATCH_STATUS,
  STATION_STATUS,
  ORDER_STATUS
}
