---
name: selfnify-host
description: Deploy, run, configure and debug bots on the Selfnify host through the selfnify-host MCP tools. Use whenever the user wants to deploy, redeploy, start, stop, restart, check, read logs of, set env vars on, configure, or delete a bot on Selfnify, or mentions the host, host.lume.dpdns.org, or a bot's RAM, autostart or crash.
---

# Selfnify host

These tools control bots on the Selfnify host: Python, Node.js, TypeScript and Rust. The MCP server already holds the user's login, so never ask for the password.

## Tools

| Tool | Use it for |
|---|---|
| `host_status` | Storage and server load. Run first if anything looks off. |
| `host_list_bots` | Overview of every bot. |
| `host_bot_info` | One bot in detail: status, PID, memory, env var names, recent output. |
| `host_bot_action` | start, stop or restart. |
| `host_logs` | Run output (`kind: run`) or dependency and build output (`kind: install`). |
| `host_set_env` | Set env vars. Needs a restart to apply. |
| `host_unset_env` | Remove env vars. Needs a restart to apply. |
| `host_config` | RAM cap (`mem_mb`), `autostart`, or main file (`entry`). |
| `host_deploy` | Upload a local folder, install, and start. Creates or updates. |
| `host_delete` | Permanently delete a bot and all its files. Needs the PIN. |

## Deploying

1. Get the full local path of the bot folder. Ask if it is unclear.
2. If you are not sure what the bot needs, call `host_deploy` with `dry_run: true` first. It lists the files without uploading anything.
3. Deploy with `host_deploy`. Language is auto-detected from `package.json`, `tsconfig.json`, `requirements.txt`, `main.py`, `bot.py` or `Cargo.toml`. Pass `start` and `main` only when auto-detection is wrong.
4. After a successful deploy, check with `host_bot_info`. A bot that says `running` with no output yet might be fine or stuck, so check `host_logs` before calling it healthy.

Redeploying an existing bot is the same call. It stops the old version, uploads the new files, reinstalls, and starts it again.

## Secrets

- `.env` files are never uploaded automatically. If the user wants their env vars on the server, read the values from the `.env` only when the user asks for that, then pass them in `env` (deploy) or `host_set_env`.
- Never print env values back in chat unless the user asks. Show key names only.
- Never write secrets into bot files, commits, or the chat.

## Deleting

`host_delete` permanently removes the bot and all its files. Always:
1. Confirm the bot name with the user.
2. Ask the user to type their PIN into the tool call. Never guess it, reuse one from earlier, or ask them to tell you the PIN in chat.

## Errors

| Error | What it means | What to do |
|---|---|---|
| `not logged in` | No saved login on this machine | Ask the user to run `host login` once in a terminal |
| `401` or `stale password` | Saved password is wrong or revoked | Ask the user to run `host login` again |
| `blocked by Cloudflare (error 1010)` | The host's firewall blocked the request | Tell the user the host admin needs to fix it |
| `server is not answering` (502) | Host service is down | Check `host_status`, then tell the user |
| `install failed` | Dependencies or build broke | Read the install log: `host_logs` with `kind: install` |
| `stopped right after starting` | Bot crashed on launch | Read the run log: `host_logs` |
| `main file ... not found` | Wrong entry file | Fix `main` or pass `main` explicitly |
| `RAM cap` warning | Node bots need more memory | `host_config` with `mem_mb: 300` or higher |
| `still installing after ...` | Long build (often Rust) | Check `host_logs` with `kind: install` later, then `host_bot_action` start |

## Logs on this machine

The MCP server writes errors and actions to `~/.selfnify/mcp.log`. If something fails with a vague error, that file has the full stack and HTTP status.
