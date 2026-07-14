function parseBooleanEnv(value, defaultValue = true) {
  if (value === undefined || value === null || String(value).trim() === '') return defaultValue
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

function resolveMockPay(env = process.env) {
  // Default true keeps demo mode safe until cloud env explicitly sets MOCK_PAY=false.
  return parseBooleanEnv(env.MOCK_PAY, true)
}

function resolveManualPhone(env = process.env) {
  return parseBooleanEnv(env.MANUAL_PHONE, true)
}

function resolveDemoAdminAccess(env = process.env) {
  const mockPay = resolveMockPay(env)
  return mockPay && parseBooleanEnv(env.DEMO_OPEN_ADMIN, true)
}

module.exports = {
  parseBooleanEnv,
  resolveMockPay,
  resolveManualPhone,
  resolveDemoAdminAccess
}
