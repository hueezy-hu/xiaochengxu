function resolveEntryContext({ wxContext = {}, event = {}, context = {} } = {}) {
  const wxOpenid = String(wxContext.OPENID || '')
  const hasTriggerMarker = Boolean(
    (context && context.triggerName) ||
    event.Type === 'Timer' ||
    event.TriggerName
  )
  const trustedSystemTrigger = !wxOpenid && hasTriggerMarker
  const openid = wxOpenid || (trustedSystemTrigger ? 'system' : 'anonymous')
  const action = event.action || (trustedSystemTrigger ? 'lifecycleTick' : '')
  return { openid, action, trustedSystemTrigger }
}

module.exports = { resolveEntryContext }
