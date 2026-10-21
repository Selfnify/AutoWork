#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { startHttp } from './http.js';
import { api, bp, HostError } from './api.js';
import { checkPin, hasPinSet, loadConfig } from './config.js';
import { deployBot, Bot, NAME_RE } from './deploy.js';
import { log, LOG_FILE, registerSecret } from './logger.js';
import { VERSION } from './version.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

async function handle(tool: string, fn: () => Promise<string>): Promise<ToolResult> {
  const t0 = Date.now();
  try {
    const text = await fn();
    log('info', tool, `ok in ${Date.now() - t0}ms`);
    return ok(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof HostError) {
      log('error', tool, msg, { status: e.status });
    } else {
      log('error', tool, e instanceof Error && e.stack ? e.stack : msg);
    }
    return fail(`Error: ${msg}`);
  }
}

const nameSchema = z
  .string()
  .min(1)
  .max(32)
  .describe('Bot name (lowercase a-z, 0-9, _ or -, max 32 characters)');

const fmtMem = (b: Bot): string => `${b.rss_mb ?? 0}/${b.mem_mb ?? '?'} MB`;

function fmtTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const fmt = (r: string[]) => r.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ');
  return [fmt(headers), ...rows.map(fmt)].join('\n');
}

function registerTools(server: McpServer): void {
  server.registerTool(
    'autowork_status',
    {
      title: 'Host status',
      description: 'Show your storage usage and how many bots are running on the Selfnify host.',
      inputSchema: {},
    },
    async () =>
      handle('autowork_status', async () => {
        const s = await api<any>('GET', '/status');
        const quota = s.you.quota_gb === null ? 'no limit' : `${s.you.quota_gb} GB`;
        return [
          `User: ${s.you.name}`,
          `Storage: ${s.you.used_mb} MB of ${quota}`,
          `Server: ${s.server.bots_running} of ${s.server.bots_total} bots running, ${s.server.ram_free_mb} MB RAM free`,
        ].join('\n');
      })
  );

  server.registerTool(
    'autowork_list_bots',
    {
      title: 'List bots',
      description: 'List all bots on the host with status, language, RAM use and autostart.',
      inputSchema: {},
    },
    async () =>
      handle('autowork_list_bots', async () => {
        const r = await api<{ bots: Bot[] }>('GET', '/bots');
        if (!r.bots.length) return 'No bots yet.';
        return fmtTable(
          ['BOT', 'LANG', 'STATUS', 'RAM', 'AUTO', 'NOTE'],
          r.bots.map((b) => [b.name, b.language, b.status, fmtMem(b), b.autostart ? 'yes' : 'no', (b.note || '').slice(0, 40)])
        );
      })
  );

  server.registerTool(
    'autowork_bot_info',
    {
      title: 'Bot info',
      description: 'Show one bot in detail: status, PID, memory, entry file, env var names, and recent output.',
      inputSchema: { name: nameSchema },
    },
    async ({ name }) =>
      handle('autowork_bot_info', async () => {
        const b = await api<Bot>('GET', bp(name));
        const lines = [
          `${b.name}: ${b.status}${b.pid ? ` (pid ${b.pid})` : ''}`,
          `language: ${b.language}${b.language === 'rust' ? '' : `, main ${b.entry}`}`,
          `memory: ${fmtMem(b)}`,
          `autostart: ${b.autostart ? 'on' : 'off'}, restart on crash: ${b.restart_on_crash ? 'on' : 'off'}`,
          `env vars: ${(b.env_keys || []).join(', ') || '(none)'}`,
        ];
        if (b.status === 'running' && b.uptime_s != null) lines.push(`uptime: ${Math.round(b.uptime_s)}s`);
        if (b.status === 'running') {
          if (b.no_output) lines.push('output: none yet (a quiet bot looks the same as a stuck one)');
          else if (b.recent_output?.length) lines.push('recent output:', ...b.recent_output.map((l) => '  ' + String(l).slice(0, 100)));
        }
        if (b.note) lines.push(`note: ${b.note}`);
        return lines.join('\n');
      })
  );

  server.registerTool(
    'autowork_bot_action',
    {
      title: 'Start, stop or restart a bot',
      description: 'Start, stop or restart a bot. Restart stops it and starts it again.',
      inputSchema: {
        name: nameSchema,
        action: z.enum(['start', 'stop', 'restart']).describe('What to do'),
      },
    },
    async ({ name, action }) =>
      handle('autowork_bot_action', async () => {
        if (action === 'restart') {
          try {
            await api('POST', bp(name, '/stop'));
          } catch (e) {
            if (e instanceof HostError && e.status === 404) throw e;
          }
          const b = await api<Bot>('POST', bp(name, '/start'));
          return `${name}: ${b.status}${b.pid ? ` (pid ${b.pid})` : ''}`;
        }
        const b = await api<Bot>('POST', bp(name, '/' + action));
        return `${name}: ${b.status}${b.pid ? ` (pid ${b.pid})` : ''}`;
      })
  );

  server.registerTool(
    'autowork_logs',
    {
      title: 'Bot logs',
      description: 'Read the last lines of a bot run log, or its install/build log when kind is "install".',
      inputSchema: {
        name: nameSchema,
        lines: z.number().int().min(1).max(500).optional().describe('How many lines (default 50)'),
        kind: z.enum(['run', 'install']).optional().describe('run = bot output (default), install = dependency or build log'),
      },
    },
    async ({ name, lines, kind }) =>
      handle('autowork_logs', async () => {
        const n = lines ?? 50;
        const k = kind ?? 'run';
        const r = await api<{ logs: string }>('GET', bp(name, '/logs') + `?lines=${n}&kind=${k}`);
        return r.logs || '(no logs yet)';
      })
  );

  server.registerTool(
    'autowork_set_env',
    {
      title: 'Set env vars',
      description:
        'Set environment variables on a bot. Values are stored on the server, not in chat history. Restart the bot to apply.',
      inputSchema: {
        name: nameSchema,
        vars: z.record(z.string(), z.string()).describe('Map of KEY to VALUE'),
      },
    },
    async ({ name, vars }) =>
      handle('autowork_set_env', async () => {
        if (!Object.keys(vars).length) throw new Error('no variables given');
        const r = await api<{ env_keys: string[] }>('POST', bp(name, '/env'), { body: vars });
        return `Set ${Object.keys(vars).length} var(s) on ${name}. ${r.env_keys.length} on the server now. Restart to apply.`;
      })
  );

  server.registerTool(
    'autowork_unset_env',
    {
      title: 'Remove env vars',
      description: 'Remove environment variables from a bot by key name. Restart to apply.',
      inputSchema: {
        name: nameSchema,
        keys: z.array(z.string()).min(1).describe('Variable names to remove'),
      },
    },
    async ({ name, keys }) =>
      handle('autowork_unset_env', async () => {
        const body: Record<string, null> = {};
        keys.forEach((k) => (body[k] = null));
        const r = await api<{ env_keys: string[] }>('POST', bp(name, '/env'), { body });
        return `Removed ${keys.join(', ')} from ${name}. ${r.env_keys.length} on the server now. Restart to apply.`;
      })
  );

  server.registerTool(
    'autowork_config',
    {
      title: 'Bot config',
      description: 'Change a bot settings: RAM cap (mem_mb, at least 30), autostart on boot, or the main entry file.',
      inputSchema: {
        name: nameSchema,
        mem_mb: z.number().int().min(30).optional().describe('RAM cap in MB'),
        autostart: z.boolean().optional().describe('Start this bot automatically when the host boots'),
        entry: z.string().optional().describe('Main file to run, e.g. index.js or main.py. Restart to apply.'),
      },
    },
    async ({ name, mem_mb, autostart, entry }) =>
      handle('autowork_config', async () => {
        const body: Record<string, unknown> = {};
        if (autostart !== undefined) body.autostart = autostart;
        if (mem_mb !== undefined) body.mem_mb = mem_mb;
        if (entry !== undefined) body.entry = entry;
        if (!Object.keys(body).length) throw new Error('nothing to change. Pass mem_mb, autostart or entry.');
        await api('POST', bp(name, '/config'), { body });
        const b = await api<Bot>('GET', bp(name));
        return `Updated ${Object.keys(body).join(', ')} on ${name}. ${entry !== undefined ? 'Restart to run the new main file.' : ''}`.trim() +
          `\nCurrent: ${b.status}, memory ${fmtMem(b)}, autostart ${b.autostart ? 'on' : 'off'}`;
      })
  );

  server.registerTool(
    'autowork_deploy',
    {
      title: 'Deploy a bot',
      description:
        'Deploy a local folder as a bot: pack it, upload it, install dependencies, and start it. Creates the bot if it does not exist, otherwise updates it. Language is detected from files (package.json, tsconfig.json, requirements.txt, Cargo.toml) unless start is given. Files named .env are NEVER uploaded automatically; pass env explicitly to set variables.',
      inputSchema: {
        path: z.string().describe('Full path to the local folder to deploy'),
        name: nameSchema.optional().describe('Bot name. Defaults to the folder name.'),
        start: z
          .string()
          .optional()
          .describe('How to run it: "python", "node", "ts" or "cargo", optionally with a main file, e.g. "node index.js"'),
        main: z.string().optional().describe('Main file to run, overrides auto-detection'),
        mem_mb: z.number().int().min(30).optional().describe('RAM cap in MB'),
        autostart: z.boolean().optional().describe('Start automatically when the host boots'),
        env: z.record(z.string(), z.string()).optional().describe('Environment variables to set before starting'),
        dry_run: z.boolean().optional().describe('Only list what would be uploaded, upload nothing'),
        no_install: z.boolean().optional().describe('Skip installing dependencies and building (you must have uploaded them already)'),
      },
    },
    async (args) =>
      handle('autowork_deploy', async () => {
        if (args.name && !NAME_RE.test(args.name.toLowerCase())) throw new Error('bad bot name');
        return deployBot({
          path: args.path,
          name: args.name,
          start: args.start,
          main: args.main,
          memMb: args.mem_mb,
          autostart: args.autostart,
          env: args.env,
          dryRun: args.dry_run,
          noInstall: args.no_install,
        });
      })
  );

  server.registerTool(
    'autowork_delete',
    {
      title: 'Delete a bot',
      description:
        'Permanently delete a bot and ALL its files on the host. Requires the user to type their PIN in the tool call. Never guess or reuse a PIN. Ask the user for it.',
      inputSchema: {
        name: nameSchema,
        pin: z.string().regex(/^\d{4,8}$/).describe("The user's PIN (4-8 digits), typed by the user"),
      },
    },
    async ({ name, pin }) =>
      handle('autowork_delete', async () => {
        registerSecret(pin);
        if (!hasPinSet()) throw new Error('no PIN set yet. Run `host login` in a terminal first.');
        if (!checkPin(pin)) throw new Error('wrong PIN, nothing was deleted');
        await api('DELETE', bp(name));
        log('warn', 'autowork_delete', `deleted bot ${name}`);
        return `Deleted ${name} and all its files.`;
      })
  );
}

async function main(): Promise<void> {
  registerSecret(loadConfig().password);

  process.on('uncaughtException', (err) => log('error', 'process', `uncaught exception: ${err.stack || err.message}`));
  process.on('unhandledRejection', (reason) => log('error', 'process', `unhandled rejection: ${String(reason)}`));

  const makeServer = (): McpServer => {
    const s = new McpServer({ name: 'autowork', version: VERSION });
    registerTools(s);
    return s;
  };

  if (process.argv.includes('--http')) {
    const secret = process.env.AUTOWORK_SECRET || '';
    if (secret.length < 24) throw new Error('AUTOWORK_SECRET must be set to at least 24 random characters');
    registerSecret(secret);
    const host = process.env.AUTOWORK_HOST || '127.0.0.1';
    const port = Number(process.env.AUTOWORK_PORT || 8766);
    startHttp(makeServer, host, port, secret);
    log('info', 'server', `autowork-mcp ${VERSION} started in http mode (log: ${LOG_FILE})`);
    return;
  }

  await makeServer().connect(new StdioServerTransport());
  log('info', 'server', `autowork-mcp ${VERSION} started (log: ${LOG_FILE})`);
}

main().catch((err) => {
  log('error', 'server', `failed to start: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
