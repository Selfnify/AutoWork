import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './config.js';

export const LOG_FILE = path.join(CONFIG_DIR, 'autowork.log');
const MAX_LOG_BYTES = 2 * 1024 * 1024;

const secrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 4) secrets.add(value);
}

function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function rotateIfNeeded(): void {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch {
    /* no log yet */
  }
}

export function log(level: 'info' | 'warn' | 'error', scope: string, message: string, details?: unknown): void {
  let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (details !== undefined) {
    try {
      line += ' ' + JSON.stringify(details);
    } catch {
      /* unserializable details are skipped */
    }
  }
  line = redact(line) + '\n';
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line, { mode: 0o600 });
  } catch {
    /* logging must never take the server down */
  }
  process.stderr.write(line);
}
