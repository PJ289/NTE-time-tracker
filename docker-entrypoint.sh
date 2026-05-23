#!/bin/sh
set -e

DATA_DIR="${NTE_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# Bind mounts (e.g. /opt/... on a NAS) are often root-owned; fix ownership when we start as root.
if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node "$DATA_DIR"; then
    echo "nte-tracker: warning: could not chown ${DATA_DIR} (some filesystems block this)." >&2
    echo "nte-tracker: ensure the mount is writable by UID/GID 1000 (user node)." >&2
  fi
  exec gosu node "$@"
fi

exec "$@"
