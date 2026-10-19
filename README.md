# selfnify-host-mcp

An MCP server that lets Claude deploy and manage bots on the Selfnify host: deploy, start, stop, restart, logs, env vars, config, and delete.

## Setup

1. Log in once with the Selfnify CLI. This stores your password and PIN in `~/.selfnify/host.json`. The MCP server reuses that login, so it never asks for your password.

   ```
   host login
   ```

2. Install and build:

   ```
   git clone https://github.com/Selfnify/Selfnify-host-mcp-.git
   cd Selfnify-host-mcp-
   npm install
   npm run build
   ```

3. Add it to Claude. For Claude Desktop, edit `claude_desktop_config.json` and add:

   ```json
   {
     "mcpServers": {
       "selfnify-host": {
         "command": "node",
         "args": ["C:\\full\\path\\to\\Selfnify-host-mcp-\\dist\\index.js"]
       }
     }
   }
   ```

   Restart Claude Desktop afterwards. For Claude Code:

   ```
   claude mcp add selfnify-host -- node /full/path/to/Selfnify-host-mcp-/dist/index.js
   ```

## Tools

| Tool | Description |
|---|---|
| `host_status` | Storage use and server load |
| `host_list_bots` | All bots with status and RAM |
| `host_bot_info` | One bot in detail |
| `host_bot_action` | Start, stop or restart a bot |
| `host_logs` | Run or install logs |
| `host_set_env` / `host_unset_env` | Manage env vars |
| `host_config` | RAM cap, autostart, main file |
| `host_deploy` | Deploy a local folder (with `dry_run` and `no_install` options) |
| `host_delete` | Delete a bot. Requires the PIN. |

Claude also reads `SKILL.md` for the workflow rules.

## Safety

- `.env` files are never uploaded unless you explicitly pass the variables.
- `node_modules`, `.git`, `target` and similar folders are excluded from uploads.
- Deletes require your PIN, typed into the tool call.
- Secrets (password, PIN) are redacted from the log.

## Logs

Errors and actions are logged to `~/.selfnify/mcp.log` (rotated at 2 MB). The same lines also go to stderr, which Claude Desktop shows in its MCP logs.

## Development

```
npm install
npm run build
```

Requires Node.js 18 or newer.
