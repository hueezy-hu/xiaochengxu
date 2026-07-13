const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const v3Path = path.join(root, '设计稿v3-解包版.html');
const v4Path = path.join(root, '设计稿v4-V1.7.html');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('V1.7 design prototype keeps v3 and provides sixteen navigable screens', () => {
  assert.equal(fs.existsSync(v3Path), true, 'v3 design source must exist');
  assert.equal(fs.existsSync(v4Path), true, 'v4 design deliverable must exist');

  const html = read(v4Path);
  const expectedIds = ['home', ...Array.from({ length: 15 }, (_, index) => `p${index + 1}`)];
  for (const id of expectedIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing screen anchor ${id}`);
  }
});
test('V1.7 design prototype contains the new transaction and fulfillment rules', () => {
  const html = read(v4Path);
  const required = [
    'V1.7 新增',
    '购物车',
    '加购不占库存',
    '手机号尾号后 4 位',
    '3:00',
    '已拼 4/5 人',
    '有人核销',
    '无人放置',
    '成团结果通知',
    '取货提醒',
    '整单退款',
    '申请退款',
    '交付现场照片',
    '催开团',
    '10:00',
  ];

  for (const text of required) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing V1.7 copy: ${text}`);
  }
});

test('V1.7 design prototype removes superseded UI rules', () => {
  const html = read(v4Path);
  const forbidden = [
    '15分钟',
    '15 分钟',
    '6 位核销码',
    '6位核销码',
    '满5件成团',
    '满 5 件成团',
    '累计5件达配送门槛',
  ];

  for (const text of forbidden) {
    assert.equal(html.includes(text), false, `obsolete rule remains: ${text}`);
  }
});

test('V1.7 design prototype has no duplicate ids or broken internal anchors', () => {
  const html = read(v4Path);
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], `duplicate ids: ${duplicates.join(', ')}`);

  const hrefs = [...html.matchAll(/href=["']#([^"']+)["']/g)].map((match) => match[1]);
  const idSet = new Set(ids);
  const missing = [...new Set(hrefs.filter((href) => !idSet.has(href)))];
  assert.deepEqual(missing, [], `broken anchors: ${missing.join(', ')}`);
});
