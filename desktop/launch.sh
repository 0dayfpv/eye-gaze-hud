#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/home/hamzafpv/.unsloth/node/bin:$PATH"
exec "$DIR/node_modules/.bin/electron" "$DIR" "$@"
