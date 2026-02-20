# Releasing brosh

## Version Files

Both must stay in sync:

- `package.json` (root — CLI/npm package)
- `packages/desktop-electron/package.json` (desktop app)

The CI publish workflow syncs desktop to root automatically during build, but
the release workflow bumps both via `npm version`.

## Automated Release Flow

```
release.yml (manual dispatch)
  → npm version patch/minor/major
  → git push --follow-tags
  → publish.yml (triggered by v* tag)
      ├─ npm publish (CLI to npm registry)
      └─ electron-builder --publish always (desktop to GitHub Releases)
          │  macOS: signed + notarized
          → apt-repo.yml (triggered on publish success)
              → generates install.sh / uninstall.sh
              → signs with GPG
              → commits to main
```

### 1. Trigger the release

Go to **Actions → Release → Run workflow** on GitHub. Pick `patch`, `minor`, or `major`.

This runs `npm version <type>` which:
- Bumps `package.json` (root)
- Bumps `packages/desktop-electron/package.json`
- Creates a commit: `Release v<version>`
- Creates a git tag: `v<version>`
- Pushes to `main` with the tag

### 2. Publish (automatic)

The `v*` tag triggers `publish.yml`:

- **npm publish** — publishes the CLI package to npm with provenance
- **Desktop builds** — matrix of macOS (x64/arm64) and Linux (x64/arm64)
  - Syncs version from root → desktop `package.json`
  - Downloads ML models
  - Linux: compiles sandbox binaries (bubblewrap, socat)
  - macOS: signs with Developer ID cert, notarizes with Apple
  - Runs `electron-builder --publish always` → uploads to GitHub Releases
- **GitHub Release** — created with auto-generated release notes

### 3. Install scripts (automatic)

On publish success, `apt-repo.yml`:
- Generates `website/install.sh` and `website/uninstall.sh`
- Signs `install.sh` with GPG
- Exports GPG public key to `website/gpg.key`
- Commits and pushes to `main`

This produces the "Update install scripts for vX.Y.Z" commit you see after each release.

## Pre-release Checklist

- [ ] All changes merged to `main`
- [ ] CI passing on `main` (ci.yml green)
- [ ] Tested locally: `cd packages/desktop-electron && npm run dev`
- [ ] No stale version numbers in code (check About dialog, analytics, etc.)

## Post-release Checklist

- [ ] GitHub Release page has all artifacts (.dmg, .zip, .deb for each arch)
- [ ] npm package is live: `npm info brosh version`
- [ ] Install script works: `curl -fsSL https://elleryfamilia.github.io/brosh/install.sh | sudo bash`
- [ ] Auto-updater finds the new version (existing installs get notified)
- [ ] macOS .dmg opens without Gatekeeper warnings

## Secrets Required

| Secret | Used by | Purpose |
|--------|---------|---------|
| `GITHUB_TOKEN` | release.yml, publish.yml | Git push, GitHub Releases |
| `NPM_TOKEN` | publish.yml | npm registry publish |
| `GPG_PRIVATE_KEY` | apt-repo.yml | Sign install scripts |
| `MAC_CERTS` | publish.yml | Base64-encoded .p12 certificate |
| `MAC_CERTS_PASSWORD` | publish.yml | Password for the .p12 file |
| `APPLE_ID` | publish.yml | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | publish.yml | App-specific password for notarization |
| `APPLE_TEAM_ID` | publish.yml | Apple Developer Team ID |

## macOS Code Signing Setup

### One-time: Create the certificate

1. Open **Keychain Access** → **Certificate Assistant** → **Request a Certificate from a Certificate Authority**
   - Enter your email, leave CA email blank, select "Saved to disk"
2. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates)
   - Click **+** → **Developer ID Application** → upload the CSR from step 1
   - Download the `.cer` and double-click to import into Keychain Access
3. Verify it appears in Keychain Access under "My Certificates" as
   `Developer ID Application: Your Name (TEAM_ID)`

### One-time: Create an app-specific password

1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**
2. Generate one, name it something like "brosh notarization"
3. Save the generated password — you'll need it for the `APPLE_APP_SPECIFIC_PASSWORD` secret

### One-time: Find your Team ID

Your Team ID is shown at [developer.apple.com/account](https://developer.apple.com/account)
under **Membership Details** (10-character alphanumeric string).

### Export the certificate for GitHub Actions

```bash
# Export from Keychain Access as .p12 (set a strong password when prompted):
# Keychain Access → My Certificates → right-click the "Developer ID Application" cert
#   → Export → save as Certificates.p12

# Base64-encode for GitHub secrets:
base64 -i Certificates.p12 -o Certificates.base64
cat Certificates.base64 | pbcopy  # copies to clipboard
```

### Add GitHub secrets

Go to **Settings → Secrets and variables → Actions** on the repo and add:

| Secret | Value |
|--------|-------|
| `MAC_CERTS` | The base64 string from the step above |
| `MAC_CERTS_PASSWORD` | The password you set when exporting the .p12 |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-character Team ID |

### Local signing

For local builds (`npm run package:mac`), electron-builder will automatically
sign if the Developer ID certificate is in your Keychain. To also notarize
locally, set these environment variables:

```bash
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

cd packages/desktop-electron
npm run package:mac
```

Without these env vars, local builds will be signed (via Keychain) but not
notarized — which is fine for development.

## Manual / Local Build

```bash
# CLI
npm install && npm run build
npm pack  # creates tarball

# Desktop (current platform only)
cd packages/desktop-electron
npm run package        # builds + packages for current OS
# Or target a specific platform:
npm run package:mac
npm run package:linux
```

Output goes to `packages/desktop-electron/release/`.

## Auto-updater Behavior

- Uses `electron-updater` with GitHub Releases as the update source
- Checks every 4 hours (configurable in settings)
- Does **not** auto-download — user clicks "Download" in the toast
- Auto-installs on app quit after download
- With signed builds, updates install seamlessly
- Without signing, falls back to opening the GitHub release page
