#!/usr/bin/env bash
set -euo pipefail

REPO="elleryfamilia/brosh"
GPG_KEY_URL="https://bro.sh/gpg.key"

# Detect architecture
ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
case "$ARCH" in
  amd64|x86_64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Error: unsupported architecture: $ARCH"; exit 1 ;;
esac

# Determine version (use argument, or fetch latest)
if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4 | sed 's/^v//')
fi

DEB_URL="https://github.com/$REPO/releases/download/v${VERSION}/brosh-desktop_${VERSION}_${ARCH}.deb"
TMP_DEB=$(mktemp /tmp/brosh-XXXXXX.deb)

echo "Installing brosh v${VERSION} for ${ARCH}..."

# Download
curl -fSL "$DEB_URL" -o "$TMP_DEB"

# Verify GPG signature if key is available
if command -v gpg >/dev/null 2>&1; then
  curl -fsSL "$GPG_KEY_URL" | gpg --import --batch 2>/dev/null || true
fi

# Install
if command -v apt >/dev/null 2>&1; then
  sudo apt install -y "$TMP_DEB"
else
  sudo dpkg -i "$TMP_DEB" || sudo apt-get install -f -y
fi

rm -f "$TMP_DEB"
echo "brosh v${VERSION} installed successfully."
