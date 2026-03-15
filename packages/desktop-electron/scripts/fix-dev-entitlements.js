/**
 * Re-sign the dev Electron binary with microphone entitlement.
 *
 * The stock Electron.app ships with a broken signature on macOS, so
 * systemPreferences.askForMediaAccess("microphone") silently returns
 * "denied" instead of showing the TCC prompt.  Re-signing with ad-hoc
 * identity + the audio-input entitlement fixes this.
 *
 * Runs automatically via postinstall; safe to re-run at any time.
 */

import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.platform !== "darwin") {
  process.exit(0);
}

const electronApp = join(
  __dirname,
  "../node_modules/electron/dist/Electron.app"
);

if (!existsSync(electronApp)) {
  // electron not installed yet (possible during CI)
  process.exit(0);
}

const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.device.audio-input</key>
  <true/>
</dict>
</plist>`;

const tmpPlist = join(__dirname, "_dev-entitlements.plist");

try {
  writeFileSync(tmpPlist, entitlements);
  execFileSync("codesign", [
    "--force", "--deep", "--sign", "-",
    "--entitlements", tmpPlist,
    electronApp,
  ], { stdio: "inherit" });
  console.log("[fix-dev-entitlements] Electron.app re-signed with microphone entitlement");
} catch (err) {
  console.warn("[fix-dev-entitlements] Failed to re-sign Electron.app:", err.message);
} finally {
  try { unlinkSync(tmpPlist); } catch {}
}
