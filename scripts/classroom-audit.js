import { linkSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { maximumAuditBytes, prepareAuditRollover, readAuditSnapshot } from '../code/backend/classroom-audit.js';
import {
  parseProtectionKey, readBoundedFile, readOperationalKeyText, replacePrivateFile
} from '../code/backend/classroom-protection.js';

const help = `检查课堂审计链并获取检查点
  node scripts/classroom-audit.js verify --file <快照> [--checkpoint <已保存检查点>]

验证并导出完整审计链，输出新的检查点
  node scripts/classroom-audit.js export --file <快照> --out <新归档文件> [--checkpoint <已保存检查点>]

核对当前文件与独立归档，生成续写分段候选
  node scripts/classroom-audit.js rollover --file <当前文件> --archive <已归档快照> --checkpoint <归档末尾检查点> --out <新分段文件>

通过 CLASSROOM_AUDIT_KEY 或 CLASSROOM_AUDIT_KEY_FILE 提供审计密钥。`;

function parseCommand() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string' }, out: { type: 'string' }, checkpoint: { type: 'string' },
      archive: { type: 'string' }, help: { type: 'boolean' }
    }
  });
  if (values.help) return null;
  const [command] = positionals;
  if (positionals.length !== 1 || !['verify', 'export', 'rollover'].includes(command) || !values.file) {
    throw new Error('请指定 verify、export 或 rollover 以及 --file。运行 --help 查看用法。');
  }
  if ((command !== 'verify') !== Boolean(values.out)) throw new Error('export 和 rollover 须用 --out 指定新文件。');
  const rollover = command === 'rollover';
  if (rollover !== Boolean(values.archive)) throw new Error('rollover 须用 --archive 指定独立归档。');
  if (rollover && !values.checkpoint) throw new Error('rollover 须用 --checkpoint 指定归档末尾检查点。');
  return { command, ...values };
}

function writeNewSnapshot(filePath, state) {
  const output = resolve(filePath);
  const workingDirectory = mkdtempSync(join(dirname(output), '.audit-export-'));
  try {
    const staged = join(workingDirectory, 'snapshot.json');
    replacePrivateFile(staged, JSON.stringify(state));
    linkSync(staged, output);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}

function rolloverSnapshot(args, key, checkpoint) {
  const active = statSync(args.file, { bigint: true });
  const archive = statSync(args.archive, { bigint: true });
  if (active.dev === archive.dev && active.ino === archive.ino) throw new Error('当前审计文件和归档须各自保管。');
  return prepareAuditRollover({
    text: readBoundedFile(args.file, maximumAuditBytes),
    archiveText: readBoundedFile(args.archive, maximumAuditBytes),
    key, checkpoint
  });
}

function run() {
  const args = parseCommand();
  if (!args) {
    console.log(help);
    return;
  }
  const environmentName = 'CLASSROOM_AUDIT_KEY';
  const key = parseProtectionKey(readOperationalKeyText(process.env, environmentName), environmentName);
  const checkpoint = args.checkpoint ? JSON.parse(readBoundedFile(args.checkpoint, 4096)) : undefined;
  const verified = args.command === 'rollover' ? rolloverSnapshot(args, key, checkpoint)
    : readAuditSnapshot({ filePath: args.file, key, checkpoint });
  if (args.out) writeNewSnapshot(args.out, verified.state);
  console.log(JSON.stringify(verified.checkpoint));
}

try {
  run();
} catch (error) {
  console.error(error.code === 'EEXIST' ? '归档文件已存在，请选择新文件。' : error.message);
  process.exitCode = 1;
}
