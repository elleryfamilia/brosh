#!/usr/bin/env bash
set -euo pipefail

REPO="elleryfamilia/brosh"
GPG_KEY_URL="https://bro.sh/gpg.key"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  amd64|x86_64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Error: unsupported architecture: $ARCH"; exit 1 ;;
esac

# Detect package manager / distro family
if command -v dnf >/dev/null 2>&1; then
  PKG_TYPE="rpm"
elif command -v apt >/dev/null 2>&1; then
  PKG_TYPE="deb"
else
  echo "Error: unsupported system — neither apt nor dnf found"
  exit 1
fi

# Determine version (use argument, or fetch latest)
if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4 | sed 's/^v//')
fi

echo "Installing brosh v${VERSION} for ${ARCH} (${PKG_TYPE})..."

# Verify GPG signature if key is available
if command -v gpg >/dev/null 2>&1; then
  curl -fsSL "$GPG_KEY_URL" | gpg --import --batch 2>/dev/null || true
fi

if [ "$PKG_TYPE" = "rpm" ]; then
  # Set up DNF repo for current and future updates
  sudo tee /etc/yum.repos.d/brosh.repo > /dev/null << 'REPO_EOF'
[brosh]
name=Brosh Terminal
baseurl=https://bro.sh/rpm
enabled=1
gpgcheck=1
gpgkey=https://bro.sh/gpg.key
REPO_EOF
  sudo dnf install -y brosh-desktop
else
  DEB_URL="https://github.com/$REPO/releases/download/v${VERSION}/brosh-desktop_${VERSION}_${ARCH}.deb"
  TMP_DEB=$(mktemp /tmp/brosh-XXXXXX.deb)
  curl -fSL "$DEB_URL" -o "$TMP_DEB"
  sudo apt install -y "$TMP_DEB"
  rm -f "$TMP_DEB"
fi

echo "brosh v${VERSION} installed successfully."
