#!/usr/bin/env bash
set -euo pipefail
echo "Removing brosh..."
sudo apt remove -y brosh-desktop 2>/dev/null || sudo dpkg -r brosh-desktop 2>/dev/null || true
echo "brosh removed."
