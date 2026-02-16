#!/usr/bin/env node

/**
 * Downloads and statically compiles the latest socat and bwrap (bubblewrap)
 * for bundling with the Electron app (Linux only).
 *
 * Static binaries are portable across Linux distros (Ubuntu, Arch, Fedora, etc.)
 * regardless of installed system libraries.
 *
 * Build deps (CI installs these):
 *   sudo apt-get install -y meson ninja-build pkg-config libcap-dev
 *
 * Licensing:
 * - socat: GPL-2.0 (spawned as child process = "mere aggregation")
 * - bwrap (bubblewrap): LGPL-2.1 (spawned as child process)
 */

import { execFileSync, execSync } from "child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  createWriteStream,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { Readable } from "stream";
import { finished } from "stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetDir = join(__dirname, "..", "resources", "bin");

if (process.platform !== "linux") {
  console.log("[sandbox-bins] Skipping: not Linux (sandbox is Linux-only)");
  process.exit(0);
}

// ── helpers ─────────────────────────────────────────────────

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ws = createWriteStream(dest);
  await finished(Readable.fromWeb(res.body).pipe(ws));
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts });
  } catch (err) {
    if (err.stderr) console.error(err.stderr);
    throw err;
  }
}

function requireTool(name) {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
  } catch {
    console.error(`[sandbox-bins] Required build tool not found: ${name}`);
    console.error("  Install with: sudo apt-get install -y meson ninja-build pkg-config libcap-dev");
    process.exit(1);
  }
}

// ── preflight ───────────────────────────────────────────────

for (const tool of ["meson", "ninja", "pkg-config", "gcc", "make", "strip"]) {
  requireTool(tool);
}

mkdirSync(targetDir, { recursive: true });
const tmpDir = mkdtempSync(join(tmpdir(), "sandbox-bins-"));
const manifest = {};

// ── bubblewrap ──────────────────────────────────────────────

async function buildBwrap() {
  console.log("[sandbox-bins] Checking latest bubblewrap release...");
  const res = await fetch("https://api.github.com/repos/containers/bubblewrap/releases/latest");
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
  const { tag_name } = await res.json();
  const version = tag_name.replace(/^v/, "");
  console.log(`[sandbox-bins] bubblewrap v${version}`);

  const tarball = join(tmpDir, `bubblewrap-${version}.tar.xz`);
  await download(
    `https://github.com/containers/bubblewrap/releases/download/${tag_name}/bubblewrap-${version}.tar.xz`,
    tarball,
  );

  execFileSync("tar", ["xf", tarball, "-C", tmpDir]);
  const src = join(tmpDir, `bubblewrap-${version}`);

  console.log("[sandbox-bins] Building bwrap (static)...");
  const buildDir = join(src, "builddir");
  run(
    `meson setup ${buildDir} --prefer-static --default-library=static -Dman=disabled -Dtests=false`,
    { cwd: src, env: { ...process.env, LDFLAGS: "-static" } },
  );
  run(`ninja -C ${buildDir}`, { cwd: src });

  const bin = join(buildDir, "bwrap");
  if (!existsSync(bin)) throw new Error("bwrap binary not produced");

  execFileSync("strip", [bin]);
  copyFileSync(bin, join(targetDir, "bwrap"));
  chmodSync(join(targetDir, "bwrap"), 0o755);

  manifest.bwrap = { package: "bubblewrap", version, builtAt: new Date().toISOString() };
  console.log(`[sandbox-bins] bwrap v${version} built`);
}

// ── socat ───────────────────────────────────────────────────

async function buildSocat() {
  console.log("[sandbox-bins] Checking latest socat release...");
  const res = await fetch("http://www.dest-unreach.org/socat/download/");
  if (!res.ok) throw new Error(`socat downloads: ${res.status}`);
  const html = await res.text();

  // Parse directory listing for socat-X.Y.Z.tar.gz (exclude socat2)
  const found = [...html.matchAll(/href="socat-([\d.]+)\.tar\.gz"/g)]
    .map((m) => m[1])
    .sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
  if (found.length === 0) throw new Error("No socat versions found on download page");
  const version = found.at(-1);
  console.log(`[sandbox-bins] socat v${version}`);

  const tarball = join(tmpDir, `socat-${version}.tar.gz`);
  await download(
    `http://www.dest-unreach.org/socat/download/socat-${version}.tar.gz`,
    tarball,
  );

  execFileSync("tar", ["xzf", tarball, "-C", tmpDir]);
  const src = join(tmpDir, `socat-${version}`);

  // Static build. Disable openssl/readline/libwrap — not needed for the
  // sandbox use case (unix domain socket proxying) and avoids needing
  // their static libraries on every build system.
  console.log("[sandbox-bins] Building socat (static)...");
  run(
    `./configure --disable-openssl --disable-readline --disable-libwrap LDFLAGS="-static"`,
    { cwd: src },
  );
  run(`make -j$(nproc)`, { cwd: src });

  const bin = join(src, "socat");
  if (!existsSync(bin)) throw new Error("socat binary not produced");

  execFileSync("strip", [bin]);
  copyFileSync(bin, join(targetDir, "socat"));
  chmodSync(join(targetDir, "socat"), 0o755);

  manifest.socat = { package: "socat", version, builtAt: new Date().toISOString() };
  console.log(`[sandbox-bins] socat v${version} built`);
}

// ── main ────────────────────────────────────────────────────

try {
  await buildBwrap();
  await buildSocat();

  writeFileSync(join(targetDir, "versions.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("[sandbox-bins] Wrote versions.json");
} catch (err) {
  console.error(`[sandbox-bins] FAILED: ${err.message}`);
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
