#!/bin/bash
# Fix chrome-sandbox SUID permissions for Electron
chown root:root /opt/brosh/chrome-sandbox 2>/dev/null || true
chmod 4755 /opt/brosh/chrome-sandbox 2>/dev/null || true
