import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProtectedAccess } from '../../code/backend/access.js';
import { createAuditLog } from '../../code/backend/classroom-audit.js';
import { createStoreProtection } from '../../code/backend/classroom-protection.js';
import { createClassroom } from '../../code/backend/classroom.js';
import { createProtectedProfile } from '../../code/backend/protected-profile.js';
import { createRequestListener, createServer } from '../../code/backend/server.js';

const issuer = 'https://identity.example.test';
const origin = 'https://learning.example.test';
const audience = `${origin}/api`;
const acr = 'urn:example:auth:mfa';
const firstClass = 'calculus-a';
const secondClass = 'calculus-b';
const teacher = 'example-teacher-a';
const otherTeacher = 'example-teacher-b';
const student = 'example-student-a';
const otherStudent = 'example-student-b';
const auditor = 'example-auditor-a';

const membership = (subject, classId, role) => ({ subject, classId, role });
const memberships = [
  membership(teacher, firstClass, 'teacher'),
  membership(otherTeacher, secondClass, 'teacher'),
  membership(student, firstClass, 'student'),
  membership(student, secondClass, 'student'),
  membership(otherStudent, firstClass, 'student'),
  membership(auditor, firstClass, 'auditor')
];

const keys = generateKeyPairSync('rsa', { modulusLength: 2_048 });

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function credential(subject) {
  const issued = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: 'RS256', typ: 'at+jwt' });
  const claims = encode({
    iss: issuer, aud: audience, sub: subject, iat: issued, exp: issued + 300, acr,
    client_id: 'example-portal', jti: randomUUID()
  });
  const signed = `${header}.${claims}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), keys.privateKey).toString('base64url')}`;
}

function makeClient(base) {
  return async (path = '', { subject, method = 'GET', body, classId, key, status = 200 } = {}) => {
    const url = new URL(`/api/classroom${path}`, base);
    if (classId) url.searchParams.set('class', classId);
    const headers = new Headers();
    if (subject) headers.set('Authorization', `Bearer ${credential(subject)}`);
    if (key) headers.set('Idempotency-Key', key);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.status, status, payload.error);
    assert.equal(payload.success, status < 400);
    return { data: payload.data, headers: response.headers };
  };
}

const publish = (request, subject = teacher, classId, status = 200) =>
  request('/publish', { subject, classId, method: 'POST', status });

const begin = (request, subject, { classId, key, status = 201 } = {}) =>
  request('/sessions', { method: 'POST', subject, classId, key, status });

async function startProtected(t) {
  const directory = await mkdtemp(join(tmpdir(), 'edu-protected-classroom-'));
  const storeKey = randomBytes(32);
  const auditKey = randomBytes(32);
  const auditFile = join(directory, 'audit.json');
  const storeFile = classId => join(directory, `${classId}.sealed.json`);
  let server;

  function profile() {
    const classrooms = new Map([firstClass, secondClass].map(classId => [classId, createClassroom({
      filePath: storeFile(classId), protection: createStoreProtection({ key: storeKey, domain: `class:${classId}` })
    })]));
    const access = createProtectedAccess({ publicKey: keys.publicKey, issuer, audience, origin, acceptedAcr: [acr], memberships });
    const audit = createAuditLog({ filePath: auditFile, key: auditKey, domain: 'test-classroom' });
    return createProtectedProfile({ access, classrooms, defaultClass: firstClass, audit, auditKey });
  }

  async function stop() {
    if (!server) return;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    server = undefined;
  }

  async function start() {
    server = http.createServer(createRequestListener({ profile: profile() }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, request: makeClient(base) };
  }

  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...await start(), start, stop, storeFile, auditFile };
}

test('受保护课堂要求凭证，保留课堂入口并关闭历史演示接口', async t => {
  assert.throws(() => createServer({ profile: {} }), /必须使用 TLS/);
  const { base, request } = await startProtected(t);
  const challenge = await request('', { status: 401 });
  assert.equal(challenge.headers.get('www-authenticate'), 'Bearer');
  assert.equal(challenge.headers.get('cache-control'), 'no-store');
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('strict-transport-security'), /max-age=/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/index.html', '/app.js', '/prototype/', '/api/decision/evaluate']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await request('', { subject: student })).data.published, false);
});

test('教师按班级发布与查询，同一学生的跨班级记录独立', async t => {
  const { request, base } = await startProtected(t);
  await publish(request, teacher, secondClass, 403);
  await publish(request, student, firstClass, 403);
  await request('/teacher', { subject: student, status: 403 });
  await request('/teacher', { subject: otherTeacher, status: 403 });
  await begin(request, teacher, { status: 403 });

  await publish(request);
  assert.equal((await request('', { subject: student })).data.published, true);
  assert.equal((await request('', { subject: student, classId: secondClass })).data.published, false);
  await begin(request, student, { classId: secondClass, status: 409 });
  await publish(request, otherTeacher, secondClass);

  const first = (await begin(request, student, { key: 'same-key' })).data;
  const second = (await begin(request, student, { key: 'same-key', classId: secondClass })).data;
  assert.notEqual(first.id, second.id);
  const firstSummary = (await request('/teacher', { subject: teacher })).data;
  const secondSummary = (await request('/teacher', { subject: otherTeacher, classId: secondClass })).data;
  assert.deepEqual(firstSummary.sessions.map(item => item.id), [first.id]);
  assert.deepEqual(secondSummary.sessions.map(item => item.id), [second.id]);
  await request('/teacher/export', { subject: student, status: 403 });
  await request('/teacher/export', { subject: teacher, classId: secondClass, status: 403 });
  const exported = await fetch(`${base}/api/classroom/teacher/export?class=${firstClass}`, {
    headers: { Authorization: `Bearer ${credential(teacher)}` }
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  const csv = await exported.text();
  assert.ok(csv.includes(first.id));
  assert.ok(!csv.includes(second.id) && !csv.includes(student));
  const auditEntries = (await request('/audit', { subject: auditor })).data;
  assert.ok(auditEntries.some(record => record.action === 'teacher.export' && record.outcome === 'success'));
  await request(`/sessions/${first.id}`, { subject: student, classId: secondClass, status: 404 });
});

test('学生只能恢复和作答自己的会话，创建幂等键按所有者隔离', async t => {
  const { request } = await startProtected(t);
  await publish(request);
  const first = (await begin(request, student, { key: 'same-key' })).data;
  const second = (await begin(request, otherStudent, { key: 'same-key' })).data;
  assert.notEqual(first.id, second.id);
  assert.equal((await begin(request, student, { key: 'same-key' })).data.id, first.id);
  await request(`/sessions/${first.id}`, { subject: otherStudent, status: 404 });
  const path = `/sessions/${first.id}/events`;
  const body = { eventId: 'approved-practice-answer', revision: first.revision, action: 'answer', choice: 'b' };
  await request(path, { method: 'POST', subject: otherStudent, body, status: 404 });
  const updated = (await request(path, { method: 'POST', subject: student, body })).data;
  assert.equal(updated.phase, 'verification');
  assert.equal((await request(`/sessions/${first.id}`, { subject: student })).data.revision, 1);
});

test('加密会话重启后可读，审计员只能查看本班的去标识记录', async t => {
  const { base, request, start, stop, storeFile, auditFile } = await startProtected(t);
  await publish(request);
  await publish(request, otherTeacher, secondClass);
  await publish(request, student, firstClass, 403);
  const fresh = (await begin(request, student)).data;
  const token = credential(student);
  const event = { eventId: 'learning-event-only', revision: fresh.revision, action: 'answer', choice: 'b' };
  const answered = await fetch(`${base}/api/classroom/sessions/${fresh.id}/events`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  assert.equal(answered.status, 200);
  const progressed = (await answered.json()).data;
  await request('/audit', { subject: teacher, status: 403 });
  await request('/audit', { subject: auditor, classId: secondClass, status: 403 });
  await request('/teacher', { subject: auditor, status: 403 });
  await stop();

  const sealed = await readFile(storeFile(firstClass), 'utf8');
  assert.equal(typeof JSON.parse(sealed).ciphertext, 'string');
  assert.ok(!sealed.includes(student));
  assert.ok(!sealed.includes(fresh.id));
  const auditRaw = await readFile(auditFile, 'utf8');
  assert.ok(!auditRaw.includes(student));
  assert.ok(!auditRaw.includes(teacher));
  assert.ok(!auditRaw.includes(token));
  assert.ok(!auditRaw.includes(event.eventId));

  const restarted = (await start()).request;
  assert.deepEqual((await restarted(`/sessions/${fresh.id}`, { subject: student })).data, progressed);
  const entries = (await restarted('/audit', { subject: auditor })).data;
  assert.ok(entries.length > 0 && entries.length <= 50);
  assert.ok(entries.every(record => record.classId === firstClass));
  assert.ok(entries.some(record => record.action === 'session.create' && record.outcome === 'success'));
  assert.ok(entries.some(record => record.action === 'session.event' && record.outcome === 'success'));
  const denied = entries.find(record => record.action === 'lesson.publish' && record.outcome === 'denied');
  assert.match(denied.actor, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(entries).includes(student));
});
