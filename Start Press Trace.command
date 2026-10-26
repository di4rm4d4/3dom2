#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 22 or later is required. Install it from https://nodejs.org/'
  read '?Press Enter to close.'
  exit 1
fi
if curl -fsS http://localhost:8765/api/status >/dev/null 2>&1; then
  open http://localhost:8765/
  exit 0
fi
print 'Starting Press Trace. Keep this terminal open while you use the app.'
(sleep 2; open http://localhost:8765/) &
node server.mjs
