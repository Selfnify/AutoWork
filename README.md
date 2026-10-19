# autowork-mcp

AutoWork is an MCP server that lets Claude deploy and manage bots on the Selfnify host: deploy, start, stop, restart, logs, env vars, config, and delete.

> **Heads up:** AutoWork lets Claude deploy, restart, change env vars and delete bots on your Selfnify host. Read what Claude plans to do before you approve a tool call, especially deletes. Deletes ask for your PIN and cannot be undone.

## Setup

1. Log in once with the Selfnify CLI. This stores your password and PIN in `~/.selfnify/host.json`. The MCP server reuses that login, so it never asks for your password.

   ```
   host login
   ```

2. Install and build:

   ```
   git clone https://github.com/Selfnify/AutoWork.git
   cd AutoWork
   npm install
   npm run build
   ```

3. Add it to Claude. For Claude Desktop, edit `claude_desktop_config.json` and add:

   ```json
   {
     "mcpServers": {
       "autowork": {
         "command": "node",
         "args": ["C:\\full\\path\\to\\AutoWork\\dist\\index.js"]
       }
     }
   }
   ```

   Restart Claude Desktop afterwards. For Claude Code:

   ```
   claude mcp add autowork -- node /full/path/to/AutoWork/dist/index.js
   ```

## Tools

| Tool | Description |
|---|---|
| `autowork_status` | Storage use and server load |
| `autowork_list_bots` | All bots with status and RAM |
| `autowork_bot_info` | One bot in detail |
| `autowork_bot_action` | Start, stop or restart a bot |
| `autowork_logs` | Run or install logs |
| `autowork_set_env` / `autowork_unset_env` | Manage env vars |
| `autowork_config` | RAM cap, autostart, main file |
| `autowork_deploy` | Deploy a local folder (with `dry_run` and `no_install` options) |
| `autowork_delete` | Delete a bot. Requires the PIN. |

Claude also reads `SKILL.md` for the workflow rules.

## Safety

- `.env` files are never uploaded unless you explicitly pass the variables.
- `node_modules`, `.git`, `target` and similar folders are excluded from uploads.
- Deletes require your PIN, typed into the tool call.
- Secrets (password, PIN) are redacted from the log.

## Logs

Errors and actions are logged to `~/.selfnify/autowork.log` (rotated at 2 MB). The same lines also go to stderr, which Claude Desktop shows in its MCP logs.

## Development

```
npm install
npm run build
```

Requires Node.js 18 or newer.

## License

MIT. See [LICENSE](LICENSE).
