const { STATION_THRESHOLD, STATION_STATUS } = require('../constants/v17')

function orderItemCount(order) {
  return (order && order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
}

function recalculateStationCounts({ batchStation = {}, activeOrders = [] } = {}) {
  const paidUserOpenids = [...new Set(activeOrders.map((order) => order.userOpenid).filter(Boolean))]
  const paidUserCount = paidUserOpenids.length
  const paidItemCount = activeOrders.reduce((sum, order) => sum + orderItemCount(order), 0)
  const threshold = Number(batchStation.thresholdN || STATION_THRESHOLD)
  let status = paidUserCount >= threshold ? STATION_STATUS.FORMED : STATION_STATUS.GROUPING

  if (batchStation.status === STATION_STATUS.DELIVERY_CONFIRMED) {
    status = paidUserCount === 0 ? STATION_STATUS.CLOSED : STATION_STATUS.DELIVERY_CONFIRMED
  } else if (batchStation.status === STATION_STATUS.FORMED && batchStation.cutoffLockedAt) {
    status = paidUserCount === 0 ? STATION_STATUS.CLOSED : STATION_STATUS.FORMED
  }

  return {
    paidUserOpenids,
    paidUserCount,
    paidItemCount,
    paidOrderCount: activeOrders.length,
    status
  }
}

module.exports = { recalculateStationCounts }
