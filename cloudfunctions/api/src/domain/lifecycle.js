const { STATION_THRESHOLD, STATION_STATUS } = require('../constants/v17')

const NOON_TERMINAL_STATUSES = new Set([
  STATION_STATUS.DELIVERY_CONFIRMED,
  STATION_STATUS.CLOSING,
  STATION_STATUS.CLOSED,
  STATION_STATUS.PICKUP_ACTIVE,
  STATION_STATUS.COMPLETED
])

function lockStationAtCutoff(station = {}, now = Date.now()) {
  const threshold = Number(station.thresholdN || STATION_THRESHOLD)
  const formed = Number(station.paidUserCount || 0) >= threshold
  return {
    _id: station._id,
    status: formed ? STATION_STATUS.FORMED : STATION_STATUS.UNFORMED,
    cutoffLockedAt: Number(now),
    formedAt: formed ? (station.formedAt || Number(now)) : null
  }
}

function decideStationAtNoon(station = {}, now = Date.now()) {
  if (station.manuallyConfirmedAt || NOON_TERMINAL_STATUSES.has(station.status)) {
    return { _id: station._id, status: station.status, shouldRefund: false, skipped: true }
  }
  const threshold = Number(station.thresholdN || STATION_THRESHOLD)
  const delivers = station.status === STATION_STATUS.FORMED || Number(station.paidUserCount || 0) >= threshold
  return {
    _id: station._id,
    status: delivers ? STATION_STATUS.DELIVERY_CONFIRMED : STATION_STATUS.CLOSING,
    shouldRefund: !delivers,
    deliveryConfirmedAt: delivers ? Number(now) : null,
    closedAt: delivers ? null : Number(now)
  }
}

module.exports = { lockStationAtCutoff, decideStationAtNoon }
