#!/usr/bin/env bash
# Starts a throwaway local Postgres 16 on port 54329 for development/tests.
# Prints the connection URL. Data lives in /tmp/21moons-local-db.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=${LOCAL_DB_DIR:-/tmp/21moons-local-db}
PORT=${PGPORT_LOCAL:-54329}
run() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ ! -d "$DIR/data" ]; then
  mkdir -p "$DIR"; [ "$(id -u)" = "0" ] && chown postgres "$DIR"
  run "$PGBIN/initdb -D $DIR/data -U postgres --auth=trust" >/dev/null
fi
if ! run "$PGBIN/pg_ctl -D $DIR/data status" >/dev/null 2>&1; then
  run "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1' -l $DIR/log -w start" >/dev/null
fi
echo "postgres://postgres@127.0.0.1:$PORT/postgres"
