import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ActiveDecisionEngine } from '../core_engine/index.js';
import { createLearningAgent } from '../core_engine/learning_agent/agent.js';
import { ClassroomError, createClassroom } from './classroom.js';
import { hintAt } from './classroom-content.js';
import { AccessError } from './access.js';
import { loadProtectedProfile } from './protected-profile.js';
import { createModelPlanner } from './model-planner.js';

const MAX_BODY_BYTES = 16 * 1024;
const CLASSROOM_PREFIX = '/api/classroom';
const protectedAssets = new Set(['/', '/classroom/', '/classroom/classroom.css', '/classroom/classroom.js']);
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const classroomPage = ['../frontend/classroom.html', 'text/html; charset=utf-8'];
const staticAssets = new Map([
  ['/', classroomPage],
  ['/index.html', ['../frontend/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['../frontend/app.js', 'text/javascript; charset=utf-8']],
  ['/classroom/', classroomPage],
  ['/classroom/classroom.css', ['../frontend/classroom.css', 'text/css; charset=utf-8']],
  ['/classroom/classroom.js', ['../frontend/classroom.js', 'text/javascript; charset=utf-8']],
  ['/prototype/', ['../../docs/software/prototype/index.html', 'text/html; charset=utf-8']],
  ['/prototype/index.html', ['../../docs/software/prototype/index.html', 'text/html; charset=utf-8']],
  ['/prototype/prototype.css', ['../../docs/software/prototype/prototype.css', 'text/css; charset=utf-8']],
  ['/prototype/prototype.js', ['../../docs/software/prototype/prototype.js', 'text/javascript; charset=utf-8']],
  ['/prototype/teacher-preview.js', ['../../docs/software/prototype/teacher-preview.js', 'text/javascript; charset=utf-8']]
]);

function sendJson(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(encoded);
}

async function serveAsset(res, [filename, type]) {
  try {
    const content = await readFile(new URL(filename, import.meta.url));
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch {
    sendJson(res, 500, { success: false, error: '页面资源暂时无法读取。' });
  }
}

async function respond(res, operation, { status = 200, errorMessage, validateDecision }) {
  try {
    sendJson(res, status, { success: true, data: await operation() });
  } catch (error) {
    if (error instanceof ClassroomError) {
      sendJson(res, error.status, { success: false, error: error.message });
    } else if (validateDecision && error instanceof TypeError) {
      sendJson(res, 400, { success: false, error: error.message });
    } else {
      console.error('[edu-promaic] 请求处理失败', error?.code ?? 'UNEXPECTED_ERROR');
      sendJson(res, 500, { success: false, error: errorMessage });
    }
  }
}

function processJson(res, chunks, onPayload) {
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    sendJson(res, 400, { success: false, error: '请求体不是有效的 JSON。' });
    return;
  }
  onPayload(payload);
}

function readJson(req, res, onPayload) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    sendJson(res, 415, { success: false, error: '请使用 application/json 提交。' });
    req.resume();
    return;
  }

  let size = 0;
  let tooLarge = false;
  const chunks = [];
  req.on('data', chunk => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      sendJson(res, 413, { success: false, error: '请求体不能超过 16 KiB。' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!tooLarge) processJson(res, chunks, onPayload);
  });
}

function allowMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  sendJson(res, 405, { success: false, error: `该接口仅接受 ${method} 请求。` });
  return false;
}

function handleDecision(req, res, engine) {
  if (!allowMethod(req, res, 'POST')) return;
  readJson(req, res, payload => respond(res, () => engine.evaluate(payload), {
    validateDecision: true, errorMessage: '决策服务暂时不可用，请稍后重试。'
  }));
}

function allowClassroomRequest(req, res) {
  if (!loopbackAddresses.has(req.socket.remoteAddress)) {
    sendJson(res, 403, { success: false, error: '课堂演示仅接受本机连接。' });
    return false;
  }
  const { origin, host } = req.headers;
  if (req.method !== 'POST' || !origin || origin === `http://${host}`) return true;
  sendJson(res, 403, { success: false, error: '请在同一课堂页面提交操作。' });
  return false;
}

function isClassroomRoute(path) {
  return path === CLASSROOM_PREFIX || path.startsWith(`${CLASSROOM_PREFIX}/`);
}

function requestUrl(req, res) {
  try {
    return new URL(req.url, 'http://localhost');
  } catch {
    sendJson(res, 400, { success: false, error: '无效的请求地址。' });
  }
}

function redirectDirectory(req, res, path) {
  if (req.method !== 'GET' || !['/prototype', '/classroom'].includes(path)) return false;
  res.writeHead(308, { Location: `${path}/` });
  res.end();
  return true;
}

const defaultError = { errorMessage: '课堂记录暂时无法读取或保存，请稍后重试。' };
const readRoles = ['student', 'teacher'];
const teacherRoles = ['teacher'];
const studentRoles = ['student'];

const classroomRoutes = new Map([
  [CLASSROOM_PREFIX, { method: 'GET', action: 'lesson.read', roles: readRoles,
    execute: ({ room }) => room.overview() }],
  [`${CLASSROOM_PREFIX}/publish`, { method: 'POST', action: 'lesson.publish', roles: teacherRoles,
    execute: ({ room }) => room.publish() }],
  [`${CLASSROOM_PREFIX}/sessions`, { method: 'POST', action: 'session.create', roles: studentRoles, status: 201,
    execute: ({ room, req, owner }) => room.createSession(req.headers['idempotency-key'], owner) }],
  [`${CLASSROOM_PREFIX}/teacher`, { method: 'GET', action: 'teacher.summary', roles: teacherRoles,
    execute: ({ room }) => room.teacherOverview() }],
  [`${CLASSROOM_PREFIX}/audit`, { method: 'GET', action: 'audit.read', roles: ['auditor'], protectedOnly: true,
    execute: ({ profile, classId }) => profile.auditTrail(classId) }]
]);

function classroomRoute(path) {
  if (classroomRoutes.has(path)) return classroomRoutes.get(path);
  const match = /^\/api\/classroom\/sessions\/([^/]+)(\/events)?$/.exec(path);
  if (!match) return null;
  const [, id, events] = match;
  return events ? {
    method: 'POST', json: true, action: 'session.event', roles: studentRoles,
    execute: ({ room, owner, payload }) => room.submit(id, payload, owner)
  } : {
    method: 'GET', action: 'session.read', roles: studentRoles,
    execute: ({ room, owner }) => room.getSession(id, owner)
  };
}

function denyClassroom(res, error) {
  if (!(error instanceof AccessError)) {
    sendJson(res, 503, { success: false, error: '课堂审计暂时不可用，请稍后重试。' });
    return;
  }
  if (error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
  sendJson(res, error.status, { success: false, error: error.message });
}

function recordOutcome(res, profile, context) {
  res.once('finish', () => {
    try {
      profile.record({ ...context, outcome: res.statusCode < 400 ? 'success' : 'error' });
    } catch {
      console.error('[edu-promaic] 审计结果写入失败', context.requestId);
    }
  });
}

function protectedContext(req, res, url, route, profile) {
  const context = { action: route.action, classId: profile.resolveClass(url.searchParams.get('class')), requestId: randomUUID() };
  let room;
  try {
    context.actor = profile.authenticate(req);
    room = profile.select(context.actor, context.classId, route.roles);
  } catch (error) {
    try {
      profile.record({ ...context, outcome: 'denied' });
    } catch (auditError) {
      return denyClassroom(res, auditError);
    }
    return denyClassroom(res, error);
  }
  try {
    profile.record({ ...context, outcome: 'allowed' });
  } catch (error) {
    return denyClassroom(res, error);
  }
  res.setHeader('X-Request-Id', context.requestId);
  recordOutcome(res, profile, context);
  return { room, profile, classId: context.classId, owner: context.actor.subject };
}

function handleClassroom(req, res, url, classroom, profile) {
  const route = classroomRoute(url.pathname);
  if (!route || (route.protectedOnly && !profile)) {
    sendJson(res, 404, { success: false, error: '未找到该资源。' });
    return;
  }
  if (!allowMethod(req, res, route.method)) return;
  const context = profile ? protectedContext(req, res, url, route, profile) : { room: classroom };
  if (!context) return;
  const execute = payload => respond(res, () => route.execute({ ...context, req, payload }),
    { ...defaultError, status: route.status });
  if (route.json) readJson(req, res, execute);
  else execute();
}

function responseHeaders(res, protectedMode) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (protectedMode) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  }
}

function nonClassroomHandler(req, res, path, { engine, profile }) {
  if (redirectDirectory(req, res, path)) return;
  if (req.method === 'GET' && path === '/api/health') {
    sendJson(res, 200, { status: 'ok', service: 'edu-promaic-backend' });
    return;
  }
  const availableAssets = profile ? protectedAssets : staticAssets;
  if (req.method === 'GET' && availableAssets.has(path)) {
    return serveAsset(res, staticAssets.get(path));
  }
  if (!profile && path === '/api/decision/evaluate') return handleDecision(req, res, engine);
  sendJson(res, 404, { success: false, error: '未找到该资源。' });
}

export function createRequestListener({ engine = new ActiveDecisionEngine(), classroomFile, agent, profile } = {}) {
  const classroom = profile ? null : createClassroom({ engine, agent, filePath: classroomFile });
  return (req, res) => {
    responseHeaders(res, Boolean(profile));
    const url = requestUrl(req, res);
    if (!url) return;
    if (isClassroomRoute(url.pathname)) {
      if (profile || allowClassroomRequest(req, res)) handleClassroom(req, res, url, classroom, profile);
      return;
    }
    nonClassroomHandler(req, res, url.pathname, { engine, profile });
  };
}

export function createServer(options = {}) {
  const { profile } = options;
  if (profile && !profile.tls) throw new Error('受保护课堂必须使用 TLS。');
  const handler = createRequestListener(options);
  const server = profile ? https.createServer(profile.tls, handler) : http.createServer(handler);
  server.requestTimeout = 10_000;
  return server;
}

function launchServer(port, host) {
  const classroomFile = process.env.CLASSROOM_FILE ?? fileURLToPath(new URL('../../output/classroom.json', import.meta.url));
  let server;
  try {
    const profile = process.env.CLASSROOM_PROFILE ?? 'demo';
    if (!['demo', 'protected'].includes(profile)) throw new Error('CLASSROOM_PROFILE 须为 demo 或 protected。');
    if (process.env.NODE_ENV === 'production' && profile !== 'protected') {
      throw new Error('生产环境须启用受保护课堂。');
    }
    const engine = new ActiveDecisionEngine();
    const planner = createModelPlanner({ apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL });
    const agent = createLearningAgent({ engine, planner, approvedFallback: hintAt });
    const protectedProfile = profile === 'protected' ? loadProtectedProfile(process.env.CLASSROOM_SECURITY_CONFIG, {
      engine, agent, storeKeyText: process.env.CLASSROOM_STORE_KEY, auditKeyText: process.env.CLASSROOM_AUDIT_KEY
    }) : undefined;
    server = createServer({ engine, agent, classroomFile, profile: protectedProfile });
  } catch (error) {
    console.error(`课堂服务启动失败：${error.message}`);
    process.exitCode = 1;
    return;
  }
  server.on('error', error => {
    console.error(`服务启动失败：${error.code === 'EADDRINUSE' ? '端口已被占用，请设置其他 PORT。' : error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Edu ProMAIC 已启动：${process.env.CLASSROOM_PROFILE === 'protected' ? 'https' : 'http'}://${host}:${port}`);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT 必须是 1 到 65535 之间的整数。');
    process.exitCode = 1;
  } else {
    launchServer(port, host);
  }
}

export default createServer;
