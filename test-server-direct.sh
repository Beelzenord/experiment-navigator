#!/bin/bash
cd /Users/alenor/scrawlers
echo "Running: pnpm server"
pnpm server 2>&1 &
PID=$!
sleep 4
echo "Checking if server started..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo "✅ Server is running!"
  curl -s http://localhost:3000/health
else
  echo "❌ Server not responding"
  echo "Process status:"
  ps -p $PID 2>/dev/null || echo "Process exited"
fi
kill $PID 2>/dev/null || pkill -f content_harvester_server 2>/dev/null || true
