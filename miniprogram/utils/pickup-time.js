const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function parseDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return { month, day, weekday: WEEKDAYS[date.getDay()] }
}

function formatPickupTime(deliveryWindow = {}) {
  const date = parseDateParts(deliveryWindow.pickupDate)
  const arriveAt = String(deliveryWindow.arriveAt || '').trim()
  const leaveAt = String(deliveryWindow.leaveAt || '').trim()
  if (!date) return arriveAt && leaveAt ? `取货日期待确认 · ${arriveAt}–${leaveAt}` : '取货时间待确认'
  const dateText = `${date.month}月${date.day}日（${date.weekday}）`
  return arriveAt && leaveAt ? `${dateText}${arriveAt}–${leaveAt}` : `${dateText}时间待确认`
}

module.exports = { formatPickupTime }
