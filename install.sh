#!/usr/bin/env bash
# install.sh — Zenn bootstrap for Claude Code
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Y4AMA/zenn/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --uninstall
#
# Downloads the repo tarball, extracts to a temp dir, runs the Node installer.
# Requires Node.js >= 18.

set -euo pipefail

REPO="Y4AMA/zenn"
BRANCH="main"
TARBALL="https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}"

# ---- colors / TUI ----
if [ -t 1 ]; then
  RED=$'\033[38;5;196m'; DRED=$'\033[38;5;88m'; GRAY=$'\033[38;5;245m'
  WHITE=$'\033[38;5;255m'; GREEN=$'\033[38;5;82m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
  RESET=$'\033[0m'
else
  RED=""; DRED=""; GRAY=""; WHITE=""; GREEN=""; BOLD=""; DIM=""; RESET=""
fi

log()  { printf "  %s·%s %s\n" "$GRAY" "$RESET" "$1"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
fail() { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1" >&2; exit 1; }

# ---- banner ----
printf "\n"
printf "%s  ███████╗███████╗███╗   ██╗███╗   ██╗%s\n" "$RED" "$RESET"
printf "%s  ╚══███╔╝██╔════╝████╗  ██║████╗  ██║%s\n" "$RED" "$RESET"
printf "%s    ███╔╝ █████╗  ██╔██╗ ██║██╔██╗ ██║%s\n" "$RED" "$RESET"
printf "%s   ███╔╝  ██╔══╝  ██║╚██╗██║██║╚██╗██║%s\n" "$RED" "$RESET"
printf "%s  ███████╗███████╗██║ ╚████║██║ ╚████║%s\n" "$RED" "$RESET"
printf "%s  ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═══╝%s\n" "$RED" "$RESET"
printf "  %srefusal suppression for claude code%s  %s· 2026%s\n\n" "$DIM" "$DIM" "$DRED" "$RESET"

# ---- node check ----
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js not found. Install Node >= 18 from https://nodejs.org"
fi
NODE_MAJOR=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node $(node -v) found — need >= 18"
fi
ok "Node $(node -v)"

# ---- fetch ----
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t zenn)
trap 'rm -rf "$TMP"' EXIT

log "Downloading Zenn source…"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$TARBALL" -o "$TMP/zenn.tar.gz" || fail "download failed"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP/zenn.tar.gz" "$TARBALL" || fail "download failed"
else
  fail "need curl or wget"
fi
ok "source downloaded"

tar -xzf "$TMP/zenn.tar.gz" -C "$TMP" || fail "extract failed"
SRC=$(find "$TMP" -maxdepth 1 -type d -name 'zenn-*' | head -n1)
[ -n "$SRC" ] || fail "source layout unexpected"
ok "source extracted"

# ---- run node installer ----
log "Running installer…"
cd "$SRC"
node install.mjs "$@"
