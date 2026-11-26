import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, release, totalmem, version } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createServer } from '../code/backend/server.js';
import { ActiveDecisionEngine } from '../code/core_engine/index.js';

const referenceEnvironment = { cpuCores: 4, memoryBytes: 8 * 1024 ** 3 };
const accepted = { action: 'INTERVENE', level: 1, reasonCode: 'REPEATED_ERRORS' };
const input = { consecutiveErrors: 2 };
const body = JSON.stringify(input);
const loopbackHost = '127.0.0.1';
const endpoint = '/api/decision/evaluate';
const requestTimeoutMs = 4_500;
const fullWorkload = { warmup: 100, measurements: 1_000, clients: 30, intervalMs: 5_000, durationMs: 600_000 };
const smokeWorkload = { warmup: 3, measurements: 10, clients: 3, intervalMs: 100, durationMs: 300 };
const acceptanceLimits = { engineP95Ms: 10, concurrentP95Ms: 200, unexpected5xxRate: 0.01 };

function distribution(values) {
  if (values.length === 0) return { p50: null, p95: null, p99: null };
  const sorted = values.toSorted((left, right) => left - right);
  const percentile = fraction => sorted[Math.ceil(sorted.length * fraction) - 1];
  return { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
}

function expectedDecision(value) {
  return value?.action === accepted.action && value.level === accepted.level && value.reasonCode === accepted.reasonCode;
}

function measureEngine(workload) {
  const engine = new ActiveDecisionEngine();
  for (let index = 0; index < workload.warmup; index++) engine.evaluate(input);
  const latencyMs = [];
  for (let index = 0; index < workload.measurements; index++) {
    const started = process.hrtime.bigint();
    const result = engine.evaluate(input);
    latencyMs.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    if (!expectedDecision(result)) throw new Error('纯规则返回与测量样例不一致。');
  }
  return { sampleCount: latencyMs.length, percentilesMs: distribution(latencyMs), latencyMs };
}

async function requestDecision(url) {
  const started = performance.now();
  let status = null;
  try {
    const response = await fetch(url, {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { 'Content-Type': 'application/json' }
    });
    status = response.status;
    const result = await response.json();
    const error = status === 200 && result?.success === true && expectedDecision(result.data)
      ? null : 'unexpected-response';
    return { latencyMs: performance.now() - started, status, error };
  } catch (error) {
    if (error.name === 'TimeoutError') return { latencyMs: performance.now() - started, status, error: 'timeout' };
    return { latencyMs: performance.now() - started, status, error: 'transport-or-parse' };
  }
}

function summarizeRequests(samples) {
  const statuses = {};
  const errors = {};
  const successfulLatency = [];
  let unexpected5xx = 0;
  for (const { latencyMs, status, error } of samples) {
    const statusKey = status === null ? 'no-response' : String(status);
    statuses[statusKey] = (statuses[statusKey] ?? 0) + 1;
    if (status >= 500 && status < 600) unexpected5xx++;
    if (error) errors[error] = (errors[error] ?? 0) + 1;
    else successfulLatency.push(latencyMs);
  }
  const successCount = successfulLatency.length;
  return {
    sampleCount: samples.length, successCount, statuses, errors,
    unexpected5xx, unexpected5xxRate: unexpected5xx / samples.length,
    failureRate: (samples.length - successCount) / samples.length,
    percentilesMs: distribution(successfulLatency), samples
  };
}

async function measureSerialHttp(url, workload) {
  for (let index = 0; index < workload.warmup; index++) {
    const result = await requestDecision(url);
    if (result.error) throw new Error('HTTP 预热请求未返回预期的决定。');
  }
  const samples = [];
  for (let index = 0; index < workload.measurements; index++) samples.push(await requestDecision(url));
  return summarizeRequests(samples);
}

async function waitUntil(deadline) {
  const remaining = deadline - performance.now();
  if (remaining > 1) await wait(Math.ceil(remaining));
}

async function measureConcurrentHttp(url, { clients, intervalMs, durationMs }) {
  const waves = [];
  const samples = [];
  const wavesExpected = Math.ceil(durationMs / intervalMs);
  const started = performance.now();
  for (let index = 0; index < wavesExpected; index++) {
    const offsetMs = index * intervalMs;
    await waitUntil(started + offsetMs);
    waves.push({ scheduledOffsetMs: offsetMs, actualOffsetMs: performance.now() - started });
    const results = await Promise.all(Array.from({ length: clients }, () => requestDecision(url)));
    samples.push(...results);
  }
  await waitUntil(started + durationMs);
  return { elapsedMs: performance.now() - started, waves, ...summarizeRequests(samples) };
}

function environment() {
  const logicalCpuCount = cpus().length;
  const memoryBytes = totalmem();
  return {
    platform: process.platform, osRelease: release(), osVersion: version(), architecture: process.arch,
    node: process.versions.node, cpuModel: cpus()[0]?.model ?? null, logicalCpuCount,
    availableParallelism: availableParallelism(), memoryBytes, referenceEnvironment,
    matchesReference: logicalCpuCount === referenceEnvironment.cpuCores && memoryBytes === referenceEnvironment.memoryBytes
  };
}

function referenceLimits(machine) {
  if (machine.platform !== 'linux') throw new Error('参考测量需要 Linux cgroup v2。');
  const unified = readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'));
  if (!unified) throw new Error('参考测量需要 Linux cgroup v2。');
  const cgroupDirectory = join('/sys/fs/cgroup', unified.slice(3));
  const readLimit = name => readFileSync(join(cgroupDirectory, name), 'utf8').trim();
  const [quota, period] = readLimit('cpu.max').split(/\s+/).map(Number);
  const limits = {
    cpuSet: readLimit('cpuset.cpus.effective'),
    cpuParallelism: machine.availableParallelism,
    cpuQuotaCores: quota / period,
    memoryLimitBytes: Number(readLimit('memory.max')),
    effectiveMemoryLimitBytes: process.constrainedMemory(),
    swapLimitBytes: Number(readLimit('memory.swap.max'))
  };
  const { cpuCores, memoryBytes } = referenceEnvironment;
  if (limits.cpuParallelism !== cpuCores || limits.cpuQuotaCores !== cpuCores || limits.memoryLimitBytes !== memoryBytes ||
      limits.effectiveMemoryLimitBytes !== memoryBytes || limits.swapLimitBytes !== 0) {
    throw new Error(`参考测量要求 4 核、8 GiB 并关闭交换空间，实际约束 ${JSON.stringify(limits)}。`);
  }
  return limits;
}

function evaluateAcceptance(workload, engine, serialHttp, concurrentHttp) {
  const expectedConcurrent = Math.ceil(workload.durationMs / workload.intervalMs) * workload.clients;
  const checks = {
    engineLatency: engine.sampleCount === workload.measurements && engine.percentilesMs.p95 <= acceptanceLimits.engineP95Ms,
    serialRequests: serialHttp.successCount === workload.measurements,
    concurrentLatency: concurrentHttp.percentilesMs.p95 !== null && concurrentHttp.percentilesMs.p95 <= acceptanceLimits.concurrentP95Ms,
    concurrentResponses: concurrentHttp.sampleCount === expectedConcurrent && concurrentHttp.successCount === expectedConcurrent,
    unexpected5xx: concurrentHttp.unexpected5xxRate < acceptanceLimits.unexpected5xxRate
  };
  return { limits: acceptanceLimits, checks, passed: Object.values(checks).every(Boolean) };
}

async function main() {
  const { values } = parseArgs({ options: { smoke: { type: 'boolean' }, reference: { type: 'boolean' } } });
  if (values.smoke && values.reference) throw new Error('请选择快速检查或参考测量。');
  const workload = values.smoke ? smokeWorkload : fullWorkload;
  const output = values.smoke ? 'output/benchmark-classroom-smoke.json' : 'output/benchmark-classroom.json';
  const startedAt = new Date().toISOString();
  const machine = environment();
  const resourceLimits = values.reference ? referenceLimits(machine) : undefined;
  const engine = measureEngine(workload);
  const server = createServer();
  try {
    server.listen(0, loopbackHost);
    await once(server, 'listening');
    const url = `http://${loopbackHost}:${server.address().port}${endpoint}`;
    const serialHttp = await measureSerialHttp(url, workload);
    console.log(`开始 ${workload.clients} 客户端、${workload.durationMs / 1000} 秒负载测量。报告 ${output}`);
    const concurrentHttp = await measureConcurrentHttp(url, workload);
    const acceptance = values.reference ? evaluateAcceptance(workload, engine, serialHttp, concurrentHttp) : undefined;
    const report = {
      schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), mode: values.smoke ? 'smoke' : 'full',
      scope: { endpoint, binding: loopbackHost, serverAndDriverShareProcess: true, authenticated: false, externalModel: false, input },
      environment: machine, workload: { ...workload, requestTimeoutMs, scheduling: 'synchronous-bursts' },
      resourceLimits, engine, serialHttp, concurrentHttp, acceptance
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`完成 ${concurrentHttp.sampleCount} 次并发负载请求，成功 ${concurrentHttp.successCount} 次。报告 ${output}`);
    if (acceptance && !acceptance.passed) throw new Error('参考负载的延迟、样本或返回结果未达标。');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`测量失败：${error.message}`);
  process.exitCode = 1;
});
