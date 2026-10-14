import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../code/backend/server.js';

async function startServer(t, options) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (base, body, type = 'application/json') => fetch(`${base}/api/decision/evaluate`, {
  method: 'POST', headers: { 'Content-Type': type }, body
});

test('页面、脚本与健康接口由同一服务提供；私有路径不开放', async t => {
  const base = await startServer(t);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /独立验证/);
  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).status, 'ok');
  for (const path of ['/.git/config', '/package.json', '/missing']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});

test('决策接口返回首级提示，保护状态同时抑制主动求助', async t => {
  const base = await startServer(t);
  const response = await post(base, JSON.stringify({ consecutiveErrors: 2 }));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.level, 1);
  assert.equal(data.reasonCode, 'REPEATED_ERRORS');
  const protectedResponse = await post(base, JSON.stringify({
    consecutiveErrors: 10, inProtectedAssessment: true, requestedHelp: true
  }));
  assert.equal((await protectedResponse.json()).data.action, 'SILENCE');
});

test('无效 JSON、类型与范围返回 400，服务继续可用', async t => {
  const base = await startServer(t);
  for (const body of ['', '{', 'null', '[]', '{"consecutiveErrors":-1}', '{"userOptedOut":"false"}']) {
    const response = await post(base, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).success, false);
  }
  assert.equal((await post(base, '{}')).status, 200);
});

test('错误方法和媒体类型有明确响应', async t => {
  const base = await startServer(t);
  const wrongMethod = await fetch(`${base}/api/decision/evaluate`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal((await post(base, '{}', 'text/plain')).status, 415);
});

test('按字节限制请求体，包括中文多字节内容', async t => {
  const base = await startServer(t);
  const response = await post(base, JSON.stringify({ notes: '汉'.repeat(6000) }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).success, false);
  assert.equal((await post(base, '{}')).status, 200);
});

test('内部故障返回 500，不误报成输入错误或泄露内部信息', async t => {
  const base = await startServer(t, { engine: { evaluate() { throw new Error('内部细节'); } } });
  const response = await post(base, '{}');
  assert.equal(response.status, 500);
  assert.doesNotMatch((await response.json()).error, /内部细节/);
});