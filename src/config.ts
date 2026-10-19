import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_URL = 'https://host.lume.dpdns.org';
export const CONFIG_DIR = path.join(os.homedir(), '.selfnify');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'host.json');

export interface PinRecord {
  salt: string;
  hash: string;
}

export interface HostConfig {
  url?: string;
  password?: string;
  pin?: PinRecord;
}

export function loadConfig(): HostConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as HostConfig;
  } catch {
    return {};
  }
}

export function requireLogin(): { url: string; password: string } {
  const cfg = loadConfig();
  if (!cfg.password) {
    throw new Error('not logged in. Run `host login` once in a terminal first.');
  }
  return { url: (cfg.url || DEFAULT_URL).replace(/\/+$/, ''), password: cfg.password };
}

function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

export function checkPin(pin: string): boolean {
  const rec = loadConfig().pin;
  if (!rec) return false;
  const a = Buffer.from(hashPin(pin, rec.salt), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hasPinSet(): boolean {
  return Boolean(loadConfig().pin);
}
