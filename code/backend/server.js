import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ActiveDecisionEngine } from '../core_engine/index.js';

const MAX_BODY_BYTES = 16 * 1024;
const staticAssets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createServer({ engine = new ActiveDecisionEngine() } = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok', service: 'edu-promaic-backend' });
      return;
    }
    if (req.method === 'GET' && staticAssets.has(pathname)) {
      const [filename, type] = staticAssets.get(pathname);
      try {
        const content = await readFile(new URL(`../frontend/${filename}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type });
        res.end(content);
      } catch {
        sendJson(res, 500, { success: false, error: '页面资源暂时无法读取。' });
      }
      return;
    }
    if (pathname === '/api/decision/evaluate') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { success: false, error: '该接口仅接受 POST 请求。' });
        return;
      }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        sendJson(res, 415, { success: false, error: '请使用 application/json 提交。' });
        req.resume();
        return;
      }
      let size = 0;
      const chunks = [];
      let tooLarge = false;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          if (!tooLarge) {
            tooLarge = true;
            sendJson(res, 413, { success: false, error: '请求体不能超过 16 KiB。' });
          }
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (tooLarge) return;
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          sendJson(res, 400, { success: false, error: '请求体不是有效的 JSON。' });
          return;
        }
        try {
          sendJson(res, 200, { success: true, data: engine.evaluate(payload) });
        } catch (error) {
          const inputError = error instanceof TypeError;
          sendJson(res, inputError ? 400 : 500, {
            success: false,
            error: inputError ? error.message : '决策服务暂时不可用，请稍后重试。'
          });
        }
      });
      return;
    }
    sendJson(res, 404, { success: false, error: '未找到该资源。' });
  });
  server.requestTimeout = 10_000;
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT 必须是 1 到 65535 之间的整数。');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', error => {
      console.error(`服务启动失败：${error.code === 'EADDRINUSE' ? '端口已被占用，请设置其他 PORT。' : error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      console.log(`Edu ProMAIC 已启动：http://${host}:${port}`);
    });
  }
}

export default createServer;