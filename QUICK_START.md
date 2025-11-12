# Quick Fix: Run Server Directly

Since `pnpm server` seems to have issues, use this command instead:

```bash
pnpm exec tsx src/content_harvester_server.ts
```

Or create an alias:

```bash
alias start-server="cd /Users/alenor/scrawlers && pnpm exec tsx src/content_harvester_server.ts"
```

Then run:
```bash
start-server
```

The server will start and show:
```
[Server] Initializing Content Harvester HTTP Server...
🚀 Content Harvester HTTP Server running on port 3000
```

