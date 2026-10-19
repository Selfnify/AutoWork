import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { api, bp, HostError, sleep } from './api.js';
import { log } from './logger.js';

export const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', 'target', '__pycache__', '.idea', '.vscode']);
export const EXCLUDE_FILES = new Set(['.env', '.DS_Store']);
export const MAX_UPLOAD_MB = 95;
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type Lang = 'python' | 'node' | 'typescript' | 'rust';

export interface Bot {
  name: string;
  language: Lang;
  status: string;
  entry?: string;
  pid?: number | null;
  mem_mb?: number;
  rss_mb?: number;
  env_keys?: string[];
  autostart?: boolean;
  restart_on_crash?: boolean;
  note?: string;
  no_output?: boolean;
  uptime_s?: number | null;
  recent_output?: string[];
}

export interface DeployOptions {
  path: string;
  name?: string;
  start?: string;
  main?: string;
  memMb?: number;
  autostart?: boolean;
  env?: Record<string, string>;
  dryRun?: boolean;
  noInstall?: boolean;
  maxInstallWaitSec?: number;
}

interface Parsed {
  lang: Lang;
  entry: string | null;
}

function parseStart(str: string): Parsed {
  const tokens = String(str).trim().split(/\s+/);
  const cmd = tokens[0].toLowerCase().replace(/\.exe$/, '');
  let lang: Lang | null = null;
  if (['python', 'python3', 'py'].includes(cmd)) lang = 'python';
  else if (['node', 'nodejs'].includes(cmd)) lang = 'node';
  else if (['ts', 'typescript', 'tsx', 'ts-node'].includes(cmd)) lang = 'typescript';
  else if (['cargo', 'rust'].includes(cmd)) lang = 'rust';
  if (!lang && ['npm', 'npx', 'pnpm', 'yarn', 'bun'].includes(cmd)) {
    throw new Error(`"${cmd}" is not a start command here. Use: python, node (JavaScript), ts (TypeScript) or cargo`);
  }
  if (!lang) throw new Error(`don't know how to run "${str}". Use: python, node, ts or cargo`);
  return { lang, entry: tokens[1] || null };
}

function detectStart(dir: string): string | null {
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  if (has('Cargo.toml')) return 'cargo';
  if (has('tsconfig.json')) return 'ts';
  if (has('package.json')) return 'node';
  if (has('requirements.txt') || has('main.py') || has('bot.py')) return 'python';
  return null;
}

function readPkg(dir: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function nodeMain(dir: string): string {
  return readPkg(dir).main || 'index.js';
}

function hasBuildScript(dir: string): boolean {
  const pkg = readPkg(dir);
  return Boolean(pkg.scripts && pkg.scripts.build);
}

function tsOutDir(dir: string): string {
  try {
    let raw = fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8');
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const m = raw.match(/"outDir"\s*:\s*"([^"]+)"/);
    if (m) {
      const rel = path.relative(dir, path.resolve(dir, m[1]));
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
    }
  } catch {
    /* fall back to the default */
  }
  return 'dist';
}

export function canBuildTs(dir: string): boolean {
  if (hasBuildScript(dir)) return true;
  const pkg = readPkg(dir);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return fs.existsSync(path.join(dir, 'tsconfig.json')) && Boolean(deps.typescript);
}

function tsMain(dir: string): string {
  const pkg = readPkg(dir);
  if (pkg.main) return pkg.main;
  const start: string = pkg.scripts && typeof pkg.scripts.start === 'string' ? pkg.scripts.start : '';
  const sm = start.match(/(?:^|[\s&;|])node\s+(?:-\S+\s+)*([^\s&|;"']+\.(?:c|m)?js)/);
  if (sm) return sm[1];
  if (canBuildTs(dir)) {
    const out = tsOutDir(dir);
    for (const f of ['index.js', 'main.js', 'bot.js']) {
      if (fs.existsSync(path.join(dir, out, f))) return out + '/' + f;
    }
    return out + '/index.js';
  }
  for (const f of ['src/index.ts', 'src/main.ts', 'index.ts', 'main.ts']) {
    if (fs.existsSync(path.join(dir, f))) return f;
  }
  return 'src/index.ts';
}

const defaultEntry = (lang: Lang): string => ({ python: 'main.py', node: 'index.js', typescript: 'dist/index.js', rust: '' })[lang];

export const sanitizeName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[-_]+/, '').slice(0, 32);

export async function packDir(dir: string): Promise<{ data: Buffer; files: string[] }> {
  const entries = fs.readdirSync(dir).filter((n) => !EXCLUDE_DIRS.has(n) && !EXCLUDE_FILES.has(n));
  if (entries.length === 0) throw new Error('nothing to upload in ' + dir);
  const files: string[] = [];
  const filter = (p: string, stat?: any): boolean => {
    const parts = String(p).split(/[\\/]/);
    if (parts.some((s) => EXCLUDE_DIRS.has(s))) return false;
    const base = parts[parts.length - 1];
    if (EXCLUDE_FILES.has(base) || base.endsWith('.pyc')) return false;
    if (stat && typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink()) return false;
    if (stat && typeof stat.isFile === 'function' && stat.isFile()) files.push(String(p));
    return true;
  };
  const stream: any = (tar as any).c({ gzip: true, cwd: dir, portable: true, filter }, entries);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (d: Buffer) => chunks.push(d));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  if (files.length === 0) throw new Error('no files to upload in ' + dir);
  return { data: Buffer.concat(chunks), files };
}

interface InstallResult {
  done: boolean;
  text: string;
}

async function installBot(name: string, lang: Lang, entryBefore: string, maxWaitSec: number): Promise<InstallResult> {
  try {
    await api('POST', bp(name, '/install'));
  } catch (e) {
    if (e instanceof HostError && /nothing to install/.test(e.message)) return { done: true, text: 'Nothing to install' };
    throw e;
  }
  const t0 = Date.now();
  for (;;) {
    await sleep(3000);
    const b = await api<Bot>('GET', bp(name));
    const secs = Math.round((Date.now() - t0) / 1000);
    if (b.status !== 'installing') {
      if (!/finished OK/.test(b.note || '')) {
        const l = await api<{ logs: string }>('GET', bp(name, '/logs') + '?lines=60&kind=install');
        throw new Error(
          (lang === 'typescript' ? 'TypeScript build' : 'install') +
            ' failed. Last lines of the log:\n' +
            (l.logs || '(empty log)') +
            `\nFull log: GET ${bp(name, '/logs')}?kind=install&lines=200`
        );
      }
      const moved = lang === 'typescript' && entryBefore && b.entry && b.entry !== entryBefore;
      return { done: true, text: `Installed in ${secs}s` + (moved ? `, main set to ${b.entry}` : '') };
    }
    if (secs >= maxWaitSec) {
      return { done: false, text: `still installing after ${secs}s. Check autowork_bot_info / autowork_logs later, then start the bot.` };
    }
  }
}

export async function deployBot(opts: DeployOptions): Promise<string> {
  const lines: string[] = [];
  const say = (s: string) => lines.push(s);
  const t0 = Date.now();
  try {
    const dir = path.resolve(opts.path);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`"${opts.path}" is not a folder (looked in ${dir}). Pass the full path.`);
    }
    const startStr = opts.start || detectStart(dir);
    if (!startStr) throw new Error('could not tell the language. Pass start: python | node | ts | cargo');
    const parsed = parseStart(startStr);
    const lang = parsed.lang;
    const main =
      opts.main || parsed.entry || (lang === 'node' ? nodeMain(dir) : lang === 'typescript' ? tsMain(dir) : defaultEntry(lang));
    const name = String(opts.name || sanitizeName(path.basename(dir))).toLowerCase();
    if (!NAME_RE.test(name)) throw new Error(`bad bot name "${name}": use a-z, 0-9, _ or -, max 32 characters`);
    const builtOnServer = lang === 'typescript' && !/\.(ts|mts|cts)$/.test(main) && canBuildTs(dir);
    if (lang !== 'rust' && !builtOnServer && !fs.existsSync(path.join(dir, main))) {
      throw new Error(`main file "${main}" not found in ${dir}`);
    }
    if (opts.memMb !== undefined && !(opts.memMb >= 30)) throw new Error('mem_mb must be 30 or more');

    say(`Deploying ${name} (${lang}${lang === 'rust' ? '' : ', main ' + main}) from ${dir}`);

    const pack = await packDir(dir);
    const mb = pack.data.length / 1024 / 1024;
    if (mb > MAX_UPLOAD_MB) {
      throw new Error(`upload is ${mb.toFixed(1)} MB (limit about ${MAX_UPLOAD_MB} MB). Look for big files that do not belong.`);
    }
    say(`Packed ${pack.files.length} files, ${mb.toFixed(1)} MB`);

    if (opts.dryRun) {
      pack.files.slice(0, 25).forEach((f) => say('  ' + f));
      if (pack.files.length > 25) say(`  ... and ${pack.files.length - 25} more`);
      say('Dry run: nothing was uploaded');
      return lines.join('\n');
    }

    const status = await api<any>('GET', '/status');
    say(`Logged in as ${status.you.name}`);

    let current: Bot;
    let existing: Bot | null = null;
    try {
      existing = await api<Bot>('GET', bp(name));
    } catch (e) {
      if (!(e instanceof HostError && e.status === 404)) throw e;
    }
    if (!existing) {
      const body: Record<string, unknown> = { name, language: lang };
      if (lang !== 'rust') body.entry = main;
      if (opts.memMb) body.mem_mb = opts.memMb;
      if (opts.autostart) body.autostart = true;
      current = await api<Bot>('POST', '/bots', { body });
      say('Created bot');
    } else {
      if (existing.language !== lang) {
        throw new Error(`"${name}" already exists as a ${existing.language} bot. Delete it first or pick another name.`);
      }
      current = existing;
      const patch: Record<string, unknown> = {};
      const explicitMain = Boolean(opts.main || parsed.entry);
      if (lang !== 'rust' && existing.entry !== main && (lang !== 'typescript' || explicitMain)) patch.entry = main;
      if (opts.memMb) patch.mem_mb = opts.memMb;
      if (opts.autostart) patch.autostart = true;
      if (Object.keys(patch).length) current = await api<Bot>('POST', bp(name, '/config'), { body: patch });
      say('Found existing bot, config updated');
    }

    if (current.status === 'installing') {
      throw new Error('an install is already running for this bot, try again in a minute');
    }
    if (current.status === 'running' && lang !== 'rust') {
      await api('POST', bp(name, '/stop'));
      say('Stopped old version');
    }
    const up = await api<{ extracted_mb: number }>('PUT', bp(name, '/upload'), { raw: pack.data, timeoutMs: 900000 });
    say(`Uploaded, ${up.extracted_mb} MB on the server`);

    if (opts.env && Object.keys(opts.env).length) {
      const r = await api<{ env_keys: string[] }>('POST', bp(name, '/env'), { body: opts.env });
      say(`Env vars set (${r.env_keys.length} on the server)`);
    }

    if (!opts.noInstall) {
      const inst = await installBot(name, lang, main, opts.maxInstallWaitSec ?? 1200);
      say(inst.text);
      if (!inst.done) return lines.join('\n');
    }

    const swap = current.status === 'running' && lang === 'rust';
    await api('POST', bp(name, swap ? '/restart' : '/start'));
    await sleep(4000);
    const now = await api<Bot>('GET', bp(name));
    if (now.status !== 'running') {
      const l = await api<{ logs: string }>('GET', bp(name, '/logs') + '?lines=15&kind=run');
      throw new Error(
        'the bot stopped right after starting. Last lines of its log:\n' +
          (l.logs || '(no output)') +
          (now.note ? `\nnote: ${now.note}` : '')
      );
    }
    say(`Running (pid ${now.pid})${now.no_output ? ', no output yet' : ''}`);
    if ((lang === 'node' || lang === 'typescript') && now.mem_mb && now.mem_mb < 300) {
      say(`Warning: RAM cap is only ${now.mem_mb} MB. Node bots often need more. Raise it with autowork_config mem_mb=300`);
    }
    say(`Done in ${Math.round((Date.now() - t0) / 1000)}s`);
    return lines.join('\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('error', 'deploy', `deploy of ${opts.path} failed`, { step: lines[lines.length - 1] ?? 'start' });
    throw new Error((lines.length ? lines.join('\n') + '\n' : '') + 'ERROR: ' + msg);
  }
}
