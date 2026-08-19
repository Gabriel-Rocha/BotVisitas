#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Crie o .env antes: cp .env.example .env"
  exit 1
fi

exec docker compose up -d --build
