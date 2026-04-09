#!/usr/bin/env bash
set -euo pipefail
echo "Removing brosh..."
if command -v dnf >/dev/null 2>&1; then
  sudo dnf remove -y brosh-desktop 2>/dev/null || true
  sudo rm -f /etc/yum.repos.d/brosh.repo
else
  sudo apt remove -y brosh-desktop 2>/dev/null || sudo dpkg -r brosh-desktop 2>/dev/null || true
fi
echo "brosh removed."
