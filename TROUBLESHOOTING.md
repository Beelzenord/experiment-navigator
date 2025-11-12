# Troubleshooting: Server Not Starting

If `pnpm server` shows no output, try these steps:

## 1. Run directly with tsx
```bash
pnpm exec tsx src/content_harvester_server.ts
```

## 2. Check for errors
```bash
pnpm server 2>&1 | head -20
```

## 3. Verify the script in package.json
```bash
cat package.json | grep server
```
Should show: `"server": "tsx src/content_harvester_server.ts"`

## 4. Check if port 3000 is available
```bash
lsof -i :3000
```
If something is using it, use a different port:
```bash
PORT=8080 pnpm server
```

## 5. Run with verbose output
```bash
DEBUG=* pnpm server
```

## 6. Check TypeScript compilation
```bash
pnpm build
```
If there are errors, fix them first.

## Expected Output

When the server starts successfully, you should see:
```
[Server] Starting Content Harvester HTTP Server...
🚀 Content Harvester HTTP Server running on port 3000
📡 Endpoints:
   POST /harvest - Harvest content from URLs
   GET  /health  - Health check
```

If you don't see this output, the server isn't starting. Check for:
- TypeScript compilation errors
- Missing dependencies
- Port conflicts
- Permission issues

