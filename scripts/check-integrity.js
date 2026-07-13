const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { TextDecoder } = require('util')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_DIRS = ['miniprogram', 'cloudfunctions/api']
const failures = []
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.wxml', '.wxss', '.md'])

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full)
    return [full]
  })
}

const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)))

for (const file of files) {
  const relative = path.relative(ROOT, file).replace(/\\/g, '/')
  const bytes = fs.readFileSync(file)
  if (TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    if (bytes.includes(0)) failures.push(`${relative}: contains NULL byte`)
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      failures.push(`${relative}: contains UTF-8 BOM`)
    }
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (err) {
      failures.push(`${relative}: invalid UTF-8`)
    }
  }

  if (file.endsWith('.js')) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (checked.status !== 0) failures.push(`${relative}: JavaScript syntax error\n${checked.stderr.trim()}`)
  }
  if (file.endsWith('.json')) {
    try { JSON.parse(bytes.toString('utf8')) } catch (err) {
      failures.push(`${relative}: invalid JSON: ${err.message}`)
    }
  }
  if (file.endsWith('.wxml')) {
    const text = bytes.toString('utf8')
    const tags = ['view', 'text', 'swiper', 'swiper-item', 'picker', 'canvas', 'block']
    for (const tag of tags) {
      const opened = (text.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) || []).length
      const closed = (text.match(new RegExp(`</${tag}>`, 'g')) || []).length
      if (opened !== closed) failures.push(`${relative}: <${tag}> ${opened} != </${tag}> ${closed}`)
    }
  }
}

const frontendJs = files.filter((file) => file.endsWith('.js') && file.includes(`${path.sep}miniprogram${path.sep}`))
const calledActions = new Set()
for (const file of frontendJs) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/(?:app\.)?call\(['"]([A-Za-z0-9_]+)['"]/g)) calledActions.add(match[1])
}
const routerSource = fs.readFileSync(path.join(ROOT, 'cloudfunctions/api/index.js'), 'utf8')
const routedActions = new Set([...routerSource.matchAll(/case ['"]([A-Za-z0-9_]+)['"]:/g)].map((match) => match[1]))
for (const action of calledActions) {
  if (!routedActions.has(action)) failures.push(`frontend action has no backend route: ${action}`)
}

const stalePatterns = [
  ['满4件', /满\s*4\s*(?:件|份)/],
  ['10:00退款截止', /10[:：]00.{0,20}(?:退款|退)/],
  ['顺延入口', /申请顺延|标记顺延/],
  ['退款审核入口', /退款待审核|退款审核中|审核退款/]
]
for (const file of files.filter((item) => /\.(js|wxml)$/.test(item))) {
  const source = fs.readFileSync(file, 'utf8')
  for (const [label, pattern] of stalePatterns) {
    if (pattern.test(source)) failures.push(`${path.relative(ROOT, file)}: stale rule ${label}`)
  }
}

if (failures.length) {
  console.error(`INTEGRITY FAIL (${failures.length})`)
  failures.forEach((failure) => console.error('- ' + failure))
  process.exit(1)
}

console.log(`INTEGRITY PASS (${files.length} files, ${calledActions.size} frontend actions)`)
