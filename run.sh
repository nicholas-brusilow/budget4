#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p rawdata
echo "Starting Budget4 — open http://localhost:8000 once the containers are healthy."
docker compose up --build "$@"
