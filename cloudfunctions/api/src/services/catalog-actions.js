const { beijingTime } = require('../../domain')
const { ERROR_CODES, success, failure } = require('../shared/response')

function createCatalogActions({ repository, now = Date.now } = {}) {
  async function statusSnapshot(input, t) {
    const date = beijingTime(t).date
    const [batch, business, nudgeCount] = await Promise.all([
      repository.getAcceptingBatch(t),
      repository.getDailyBusiness(date),
      repository.countDailyNudges(date)
    ])
    if (batch && batch.status === '接单中' && Number(batch.deadlineAt || 0) > t) {
      return { date, batch, businessStatus: '开团中', canOrder: true, canNudge: false, nudgeCount }
    }
    if (business && business.status === '今日休息') {
      return { date, batch: null, businessStatus: '今日休息', canOrder: false, canNudge: false, nudgeCount }
    }
    return { date, batch: null, businessStatus: '未开团', canOrder: false, canNudge: true, nudgeCount }
  }

  return {
    async getHomeStatus(input = {}) {
      const t = now()
      return success(input, t, await statusSnapshot(input, t))
    },
    async nudgeOpenGroup(input = {}) {
      const t = now()
      if (!input.openid) return failure(input, t, ERROR_CODES.FORBIDDEN, '需要登录后催开团')
      const snapshot = await statusSnapshot(input, t)
      if (!snapshot.canNudge) return failure(input, t, ERROR_CODES.BUSINESS_CLOSED, '当前状态不可催开团')
      const id = `${snapshot.date}:${input.openid}`
      const existingCount = snapshot.nudgeCount
      const duplicate = Boolean(await repository.getNudge(id))
      if (!duplicate) await repository.saveNudge(id, { _id: id, date: snapshot.date, userOpenid: input.openid, createdAt: t })
      return success(input, t, { duplicate, nudgeCount: duplicate ? existingCount : existingCount + 1 })
    }
  }
}

module.exports = { createCatalogActions }
