const { isPhone } = require('../shared/validation')
const { ERROR_CODES, success, failure } = require('../shared/response')

function createProfileActions({ repository, now = Date.now } = {}) {
  return {
    async updateProfile(input = {}) {
      const t = now()
      if (!input.openid) return failure(input, t, ERROR_CODES.FORBIDDEN, '需要登录')
      if (input.phone !== undefined && input.phone !== '' && !isPhone(input.phone)) {
        return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '手机号格式不正确')
      }
      const existing = await repository.getProfile(input.openid) || {}
      const profile = {
        ...existing,
        _id: input.openid,
        openid: input.openid,
        nickName: input.nickName !== undefined ? String(input.nickName).trim().slice(0, 30) : (existing.nickName || ''),
        avatarUrl: input.avatarUrl !== undefined ? String(input.avatarUrl).trim() : (existing.avatarUrl || ''),
        phone: input.phone !== undefined ? String(input.phone).trim() : (existing.phone || ''),
        createdAt: existing.createdAt || t,
        updatedAt: t
      }
      await repository.saveProfile(input.openid, profile)
      return success(input, t, { profile })
    }
  }
}

module.exports = { createProfileActions }
