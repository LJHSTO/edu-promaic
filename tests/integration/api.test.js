import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.match(await page.text(), /翻转课堂/);
  const legacyPage = await fetch(`${base}/index.html`);
  assert.match(await legacyPage.text(), /独立验证/);
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

test('第三周原型固定路由可运行，文档与源码目录不整体开放', async t => {
  const base = await startServer(t);
  const redirect = await fetch(`${base}/prototype`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/prototype/');
  for (const [path, type, content] of [
    ['/prototype/', /text\/html/, /teacherView/],
    ['/prototype/index.html', /text\/html/, /answerForm/],
    ['/prototype/prototype.css', /text\/css/, /prefers-reduced-motion/],
    ['/prototype/prototype.js', /javascript/, /renderSessions/],
    ['/prototype/teacher-preview.js', /javascript/, /synthetic/]
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), type);
    assert.match(await response.text(), content);
  }
  for (const path of ['/docs/mgmt/week3_delivery.md', '/prototype/README.md', '/code/backend/server.js']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
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

const classroomPath = '/api/classroom';

async function classroomRequest(base, path = '', { method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(base + classroomPath + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.status, status, payload.error);
  assert.equal(payload.success, status < 400);
  return payload.data;
}

const publishClassroom = base => classroomRequest(base, '/publish', { method: 'POST' });
const startClassroom = base => classroomRequest(base, '/sessions', { method: 'POST', status: 201 });
const classroomEvent = (base, session, eventId, event, status) => classroomRequest(base, `/sessions/${session.id}/events`, {
  method: 'POST', body: { eventId, revision: session.revision, ...event }, status
});

test('翻转课堂入口及资源可用，课程发布前不能创建学习会话', async t => {
  const base = await startServer(t);
  const page = await fetch(`${base}/classroom/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /翻转课堂/);
  for (const [filename, type] of [['classroom.js', /javascript/], ['classroom.css', /text\/css/]]) {
    const asset = await fetch(`${base}/classroom/${filename}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), type);
  }
  assert.equal((await classroomRequest(base)).published, false);
  await classroomRequest(base, '/sessions', { method: 'POST', status: 409 });
  assert.equal((await publishClassroom(base)).published, true);
  assert.equal((await publishClassroom(base)).published, true);
  assert.equal((await startClassroom(base)).phase, 'practice');
});

test('学生错答、线索、独立验证与教师实录走同一条链路', async t => {
  const base = await startServer(t);
  await publishClassroom(base);
  let round = await startClassroom(base);
  assert.equal(round.revision, 0);
  assert.equal('answer' in round.question, false);
  round = await classroomEvent(base, round, 'wrong-1', { action: 'answer', choice: 'a' });
  assert.equal(round.hint, null);
  round = await classroomEvent(base, round, 'wrong-2', { action: 'answer', choice: 'a' });
  assert.equal(round.hint.level, 1);
  assert.ok(round.hint.source.label);
  round = await classroomEvent(base, round, 'next-hint', { action: 'help' });
  assert.equal(round.hint.level, 2);
  round = await classroomEvent(base, round, 'practice-correct', { action: 'answer', choice: 'b' });
  assert.equal(round.phase, 'verification');
  assert.equal(round.hint, null);
  assert.equal(round.helpEnabled, false);
  await classroomEvent(base, round, 'help-protected', { action: 'help' }, 409);
  round = await classroomEvent(base, round, 'verification-wrong', { action: 'answer', choice: 'a' });
  assert.equal(round.phase, 'verification');
  assert.equal(round.hint, null);
  round = await classroomEvent(base, round, 'verification-correct', { action: 'answer', choice: 'c' });
  assert.equal(round.phase, 'complete');
  assert.equal(round.result.firstPass, false);
  assert.equal(round.result.verificationAttempts, 2);
  const teacher = await classroomRequest(base, '/teacher');
  assert.deepEqual(teacher.summary, {
    sessions: 1, practiceCompleted: 1, verificationStarted: 1, firstPass: 0, completed: 1, usedHint: 1
  });
  assert.equal(teacher.sessions[0].id, round.id);
  assert.equal(teacher.sessions[0].timeline.length, 6);
  assert.equal(teacher.sessions[0].timeline[4].misconception, 'limit_equals_function_value');
});

test('关闭线索期间继续作答，教师区分首次通过与未提交验证', async t => {
  const base = await startServer(t);
  await publishClassroom(base);
  let round = await startClassroom(base);
  round = await classroomEvent(base, round, 'mute', { action: 'toggle-help' });
  assert.equal(round.helpEnabled, false);
  for (const id of ['mute-wrong-1', 'mute-wrong-2']) {
    round = await classroomEvent(base, round, id, { action: 'answer', choice: 'a' });
    assert.equal(round.hint, null);
  }
  round = await classroomEvent(base, round, 'mute-correct', { action: 'answer', choice: 'b' });
  assert.equal((await classroomRequest(base, '/teacher')).summary.verificationStarted, 0);
  round = await classroomEvent(base, round, 'first-pass', { action: 'answer', choice: 'c' });
  assert.equal(round.result.firstPass, true);
  assert.equal(round.result.usedHint, false);
  assert.equal((await classroomRequest(base, '/teacher')).summary.firstPass, 1);
});

test('旧版本和改写事件 ID 会冲突，重传相同事件不重复计数', async t => {
  const base = await startServer(t);
  await publishClassroom(base);
  const initial = await startClassroom(base);
  const first = { action: 'answer', choice: 'a' };
  const round = await classroomEvent(base, initial, 'event-1', first);
  await classroomEvent(base, initial, 'stale', first, 409);
  await classroomEvent(base, initial, 'event-1', { action: 'answer', choice: 'b' }, 409);
  const latest = await classroomEvent(base, round, 'event-2', first);
  assert.deepEqual(await classroomEvent(base, initial, 'event-1', first), latest);
  await classroomEvent(base, latest, 'invalid-choice', { action: 'answer', choice: 'bad' }, 400);
  assert.equal((await classroomRequest(base, '/teacher')).sessions[0].timeline.length, 2);
});

test('创建会话的幂等键避免网络重试在教师汇总中重复计数', async t => {
  const base = await startServer(t);
  await publishClassroom(base);
  async function startWithKey(key) {
    const response = await fetch(base + classroomPath + '/sessions', {
      method: 'POST', headers: { 'Idempotency-Key': key }
    });
    assert.equal(response.status, 201);
    return (await response.json()).data;
  }
  const [initial, concurrent] = await Promise.all([startWithKey('start-1'), startWithKey('start-1')]);
  assert.deepEqual(concurrent, initial);
  const advanced = await classroomEvent(base, initial, 'answer-1', { action: 'answer', choice: 'b' });
  assert.deepEqual(await startWithKey('start-1'), advanced);
  const other = await startWithKey('start-2');
  assert.notEqual(other.id, initial.id);
  assert.equal((await classroomRequest(base, '/teacher')).summary.sessions, 2);
});

async function temporaryClassroom(t) {
  const directory = await mkdtemp(join(tmpdir(), 'edu-promaic-classroom-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, classroomFile: join(directory, 'data', 'classroom.json') };
}

test('重新打开存储后保留发布状态、会话、教师回放和重传记录', async t => {
  const { classroomFile } = await temporaryClassroom(t);
  const first = await startServer(t, { classroomFile });
  await publishClassroom(first);
  const initial = await startClassroom(first);
  const event = { action: 'answer', choice: 'b' };
  const saved = await classroomEvent(first, initial, 'stored', event);
  const reopened = await startServer(t, { classroomFile });
  assert.equal((await classroomRequest(reopened)).published, true);
  assert.deepEqual(await classroomRequest(reopened, `/sessions/${initial.id}`), saved);
  assert.deepEqual(await classroomEvent(reopened, initial, 'stored', event), saved);
  assert.equal((await classroomRequest(reopened, '/teacher')).sessions[0].timeline.length, 1);
});

test('存储写入失败时保留先前状态，同一事件可在恢复后重试', async t => {
  const { directory, classroomFile } = await temporaryClassroom(t);
  const base = await startServer(t, { classroomFile });
  await publishClassroom(base);
  const initial = await startClassroom(base);
  const dataDirectory = join(directory, 'data');
  const savedDirectory = join(directory, 'backup');
  await rename(dataDirectory, savedDirectory);
  await writeFile(dataDirectory, 'blocked');
  const event = { action: 'answer', choice: 'b' };
  await classroomEvent(base, initial, 'retried', event, 500);
  assert.deepEqual(await classroomRequest(base, `/sessions/${initial.id}`), initial);
  await rm(dataDirectory);
  await rename(savedDirectory, dataDirectory);
  const retried = await classroomEvent(base, initial, 'retried', event);
  assert.equal(retried.phase, 'verification');
  assert.equal((await classroomRequest(base, '/teacher')).sessions[0].timeline.length, 1);
});

test('存储文件的结构无效时报告明确的启动错误', async t => {
  const { directory } = await temporaryClassroom(t);
  const classroomFile = join(directory, 'invalid.json');
  await writeFile(classroomFile, '{"published":true}');
  assert.throws(() => createServer({ classroomFile }), /CLASSROOM_FILE/);
});

test('后台提示尚在执行时进入独立验证，迟到线索不会回写或进入教师回放', async t => {
  const { promise: started, resolve: markStarted } = Promise.withResolvers();
  const { promise: result, resolve: finish } = Promise.withResolvers();
  const agent = () => { markStarted(); return result; };
  const base = await startServer(t, { agent });
  await publishClassroom(base);
  const initial = await startClassroom(base);
  const late = classroomEvent(base, initial, 'late', { action: 'help' }, 409);
  await started;
  const verification = await classroomEvent(base, initial, 'advance', { action: 'answer', choice: 'b' });
  finish({ hint: { level: 1, text: '迟到的提示' }, trace: { outcome: 'grounded' } });
  await late;
  assert.equal(verification.phase, 'verification');
  assert.equal((await classroomRequest(base, `/sessions/${initial.id}`)).hint, null);
  const { sessions } = await classroomRequest(base, '/teacher');
  assert.deepEqual(sessions[0].timeline.map(event => event.eventId), ['advance']);
});
