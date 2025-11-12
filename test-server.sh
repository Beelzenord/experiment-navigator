#!/bin/bash
cd /Users/alenor/scrawlers
pnpm server &
SERVER_PID=$!
sleep 3
if ps -p $SERVER_PID > /dev/null 2>&1; then
  echo "Server PID: $SERVER_PID"
  curl -s http://localhost:3000/health
  kill $SERVER_PID
else
  echo "Server exited immediately"
fi
