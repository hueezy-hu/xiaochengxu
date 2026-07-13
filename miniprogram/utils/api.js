const { createRequestId } = require('./request-id')

function call(action, data = {}) {
  const requestId = data.requestId || createRequestId(action)
  return wx.cloud.callFunction({
    name: 'api',
    data: { action, ...data, requestId }
  }).then((res) => {
    const result = res.result || {}
    if (typeof result.ok !== 'boolean') {
      return { ok: false, code: 'EMPTY_RESPONSE', msg: '云函数无有效返回', requestId }
    }
    return { requestId, ...result }
  }).catch((err) => ({
    ok: false,
    code: 'NETWORK_ERROR',
    msg: '网络错误：' + (err.message || '请稍后重试'),
    requestId
  }))
}

module.exports = { call }
