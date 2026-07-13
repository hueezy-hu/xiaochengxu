const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function test(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    console.error(err.message)
    process.exitCode = 1
  }
}

test('public catalog loading never initializes demo data', () => {
  const source = read('miniprogram/app.js')
  const getCatalogPage = source.match(/async getCatalogPage\(\)[\s\S]*?\n  },/)
  assert.ok(getCatalogPage, 'getCatalogPage implementation is missing')
  assert.doesNotMatch(getCatalogPage[0], /initDemo|tailanInitDemoChecked/)
})

test('ordinary users cannot invoke a public admin binding action', () => {
  const mineSource = read('miniprogram/pages/mine/mine.js')
  const apiSource = read('cloudfunctions/api/index.js')
  assert.doesNotMatch(mineSource, /call\(['"]bindAdmin['"]\)/)
  assert.doesNotMatch(apiSource, /case ['"]bindAdmin['"]:/)
})

test('ordinary users cannot bootstrap demo data or the first superAdmin', () => {
  const index = read('cloudfunctions/api/index.js')
  assert.match(index, /case ['"]initDemo['"]:[^\n]*trustedSystemTrigger/)
})

test('order detail does not grant every admin unrestricted phone access', () => {
  const index = read('cloudfunctions/api/index.js')
  const body = index.match(/async function getOrderDetail[\s\S]*?\n}/)[0]
  assert.match(body, /order\.userOpenid !== openid/)
  assert.doesNotMatch(body, /getAdmin|&& !admin/)
})

test('first superAdmin provisioning requires an exact environment-configured openid', () => {
  const index = read('cloudfunctions/api/index.js')
  const body = index.match(/async function provisionConfiguredSuperAdmin[\s\S]*?\n}/)[0]
  assert.match(body, /process\.env\.SUPER_ADMIN_OPENID/)
  assert.match(body, /configuredOpenid !== openid/)
})

test('V1.6 frontend shared modules exist', () => {
  const required = [
    'miniprogram/utils/api.js',
    'miniprogram/utils/status.js',
    'miniprogram/utils/navigation.js',
    'miniprogram/utils/request-id.js'
  ]
  for (const relativePath of required) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, `${relativePath} is missing`)
  }
})

test('App delegates cloud requests to the unified API module', () => {
  const source = read('miniprogram/app.js')
  assert.match(source, /require\(['"]\.\/utils\/api['"]\)/)
  assert.match(source, /return api\.call\(action, data\)/)
})

test('repository integrity checker exists', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/check-integrity.js')), true)
})

test('integrity checker never treats binary assets as UTF-8 source files', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-integrity.js')], { encoding: 'utf8' })
  const output = `${run.stdout || ''}\n${run.stderr || ''}`
  assert.doesNotMatch(output, /assets[\\/]hero\.jpg: (?:contains NULL byte|invalid UTF-8)/)
  assert.doesNotMatch(output, /assets[\\/]tab-home\.png: (?:contains NULL byte|invalid UTF-8)/)
})
