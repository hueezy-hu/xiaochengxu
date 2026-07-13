const PHONE_RE = /^1\d{10}$/

function isPhone(value) {
  return PHONE_RE.test(String(value || '').trim())
}

function requiredText(value, maxLength = 100) {
  const text = String(value || '').trim()
  return text.length > 0 && text.length <= maxLength
}

module.exports = { PHONE_RE, isPhone, requiredText }
