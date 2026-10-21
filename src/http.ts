import { createServer, Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from './logger.js';

export function startHttp(makeServer: () => McpServer, host: string, port: number, secret: string): Server {
  const endpoint = `/${secret}/mcp`;

  const server = createServer(async (req, res) => {
    if (req.url !== endpoint) {
      res.writeHead(404).end('not found');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'bad json' }, id: null })
      );
      return;
    }

    const mcp = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log('error', 'http', e instanceof Error ? e.stack || e.message : String(e));
      if (!res.headersSent) res.writeHead(500).end();
    }
  });

  server.listen(port, host, () => {
    log('info', 'http', `listening on ${host}:${port} (endpoint secret set)`);
  });
  return server;
}
