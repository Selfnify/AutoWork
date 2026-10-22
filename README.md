# autowork-mcp

AutoWork is an MCP server that lets Claude deploy and manage bots on the Selfnify host: deploy, start, stop, restart, logs, env vars, config, and delete.

> **Heads up:** AutoWork lets Claude deploy, restart, change env vars and delete bots on your Selfnify host. Read what Claude plans to do before you approve a tool call, especially deletes. Deletes ask for your PIN and cannot be undone.

## Get access first

You can't create an account on your own. To get a signup token, join the Selfnify Discord server:

**https://discord.gg/wHc9Jhq9sg**

The token is what lets you create an account on the Selfnify host. Without one you can't log in, so ask in the server if you don't have it yet.

## Setup

1. Get an invite link from the owner. Then run it in a terminal, and paste your account token when asked:

   ```
   host <invite link> token
   ```

2. Open Claude Desktop settings, then Developer, then Edit Config, and add:

   ```json
   {
     "mcpServers": {
       "autowork": {
         "command": "npx",
         "args": ["-y", "autowork-mcp"]
       }
     }
   }
   ```

3. Fully quit and reopen Claude Desktop.

AutoWork runs on your own PC and uses the login saved by `host`. It never listens on the network.

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
