#!/bin/bash
set -e

pnpm install

# Clean stale build artifacts before the workflows rebuild on restart
rm -rf artifacts/api-server/dist

pnpm --filter @workspace/db run push-force
