import { requireLogin } from './config.js';
import { VERSION } from './version.js';

export class HostError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HostError';
    this.status = status;
  }
}

export interface ApiOptions {
  body?: unknown;
  raw?: Buffer;
  timeoutMs?: number;
}

export async function api<T = any>(method: string, apiPath: string, opts: ApiOptions = {}): Promise<T> {
  const { url, password } = requireLogin();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${password}`,
    'User-Agent': `selfnify-host-mcp/${VERSION}`,
  };
  let payload: any;
  if (opts.raw) {
    payload = opts.raw;
    headers['Content-Type'] = 'application/gzip';
  } else if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url + apiPath, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
    });
  } catch (e) {
    throw new HostError(`can't reach the server (${(e as Error).message})`);
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (res.ok && data) return data as T;

  let msg: string = data?.error || `HTTP ${res.status}`;
  if (!data && text.includes('1010')) msg = 'blocked by Cloudflare (error 1010), tell the host admin';
  else if (!data && res.status === 502) msg = 'server is not answering (is the service running?)';
  if (res.status === 401) msg += ' (the saved password may be stale: run `host login`)';
  throw new HostError(msg, res.status);
}

export const bp = (name: string, sub = ''): string => `/bots/${encodeURIComponent(name.toLowerCase())}${sub}`;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
