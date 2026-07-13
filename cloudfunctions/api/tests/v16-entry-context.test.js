const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { resolveEntryContext } = require('../src/shared/entry-context')

function test(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    console.error(err.stack || err.message)
    process.exitCode = 1
  }
}

test('an authenticated user cannot become system by forging timer fields', () => {
  const resolved = resolveEntryContext({
    wxContext: { OPENID: 'user-1' },
    event: { action: 'lifecycleTick', Type: 'Timer', TriggerName: 'forged' },
    context: { triggerName: 'forged-context' }
  })
  assert.equal(resolved.openid, 'user-1')
  assert.equal(resolved.trustedSystemTrigger, false)
  assert.equal(resolved.action, 'lifecycleTick')
})

test('a trusted timer without an explicit action defaults to lifecycleTick', () => {
  const resolved = resolveEntryContext({
    wxContext: {},
    event: { Type: 'Timer', TriggerName: 'tailan-lifecycle' },
    context: {}
  })
  assert.equal(resolved.openid, 'system')
  assert.equal(resolved.trustedSystemTrigger, true)
  assert.equal(resolved.action, 'lifecycleTick')
})

test('an ordinary request without WX identity stays anonymous', () => {
  const resolved = resolveEntryContext({ wxContext: {}, event: { action: 'getCatalogPage' }, context: {} })
  assert.equal(resolved.openid, 'anonymous')
  assert.equal(resolved.trustedSystemTrigger, false)
  assert.equal(resolved.action, 'getCatalogPage')
})

test('index guards lifecycleTick and never exposes expirePendingOrders directly', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  assert.match(source, /case ['"]lifecycleTick['"]:/)
  assert.match(source, /trustedSystemTrigger[^\n]*FORBIDDEN|FORBIDDEN[^\n]*trustedSystemTrigger/)
  assert.match(source, /expirePendingOrders\(\{\s*system:\s*true/)
  assert.doesNotMatch(source, /case ['"]expirePendingOrders['"]:/)
  assert.doesNotMatch(source, /case ['"]closeExpired['"]:/)
  assert.doesNotMatch(source, /case ['"]adminRefundOrder['"]:/)
})
