import { linkSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readAuditSnapshot } from '../code/backend/classroom-audit.js';
import {
  parseProtectionKey, readBoundedFile, readOperationalKeyText, replacePrivateFile
} from '../code/backend/classroom-protection.js';

const help = `检查课堂审计链并获取检查点
  node scripts/classroom-audit.js verify --file <快照> [--checkpoint <已保存检查点>]

验证并导出完整审计链，输出新的检查点
  node scripts/classroom-audit.js export --file <快照> --out <新归档文件> [--checkpoint <已保存检查点>]

通过 CLASSROOM_AUDIT_KEY 或 CLASSROOM_AUDIT_KEY_FILE 提供审计密钥。`;

function parseCommand() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string' }, out: { type: 'string' }, checkpoint: { type: 'string' }, help: { type: 'boolean' }
    }
  });
  if (values.help) return null;
  const [command] = positionals;
  if (positionals.length !== 1 || !['verify', 'export'].includes(command) || !values.file) {
    throw new Error('请指定 verify 或 export 以及 --file。运行 --help 查看用法。');
  }
  if ((command === 'export') !== Boolean(values.out)) throw new Error('仅 export 使用 --out 指定新归档文件。');
  return values;
}

function exportArchive(filePath, state) {
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

function run() {
  const args = parseCommand();
  if (!args) {
    console.log(help);
    return;
  }
  const environmentName = 'CLASSROOM_AUDIT_KEY';
  const key = parseProtectionKey(readOperationalKeyText(process.env, environmentName), environmentName);
  const checkpoint = args.checkpoint ? JSON.parse(readBoundedFile(args.checkpoint, 4096)) : undefined;
  const verified = readAuditSnapshot({ filePath: args.file, key, checkpoint });
  if (args.out) exportArchive(args.out, verified.state);
  console.log(JSON.stringify(verified.checkpoint));
}

try {
  run();
} catch (error) {
  console.error(error.code === 'EEXIST' ? '归档文件已存在，请选择新文件。' : error.message);
  process.exitCode = 1;
}
