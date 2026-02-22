import { build } from "esbuild";
import { cpSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";

const bytecode = process.argv.includes("--bytecode");

if (bytecode) {
  // Bytecode path: bundle as CJS → compile with Electron's V8 → ESM loader stub
  await build({
    entryPoints: ["src/main/index.ts"],
    bundle: true,
    outfile: "dist/main/bundle.cjs",
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: false,
    // Bytecode externals differ from ESM: CJS can't require() ESM-only packages,
    // so we inline them (electron-store, chokidar, brosh) and let esbuild convert
    // to CJS. node-pty stays external (native addon).
    external: [
      "electron",
      "electron-updater",
      "node-pty",
      "ws",
      "posthog-node",
      "@huggingface/transformers",
      "cli-highlight",
      "bytenode",
    ],
    // Convert import() → require() so no dynamic imports in bytecode (vm.Script
    // doesn't support import() without --experimental-vm-modules).
    supported: { "dynamic-import": false },
  });

  // Compile CJS bundle to V8 bytecode using Electron's V8
  const require = createRequire(import.meta.url);
  const electronPath = require("electron");
  execFileSync(electronPath, ["scripts/bytecode-compiler.cjs", "dist/main/bundle.cjs"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });

  // Write ESM loader stub
  writeFileSync(
    "dist/main/index.js",
    [
      `import { createRequire } from 'module';`,
      `import v8 from 'v8';`,
      `v8.setFlagsFromString('--no-lazy');`,
      `v8.setFlagsFromString('--no-flush-bytecode');`,
      `const require = createRequire(import.meta.url);`,
      `require('bytenode');`,
      `require('./bundle.jsc');`,
      ``,
    ].join("\n"),
  );

  // Clean up intermediate CJS bundle and stale sourcemap from previous ESM builds
  unlinkSync("dist/main/bundle.cjs");
  if (existsSync("dist/main/index.js.map")) {
    unlinkSync("dist/main/index.js.map");
  }
} else {
  // Standard ESM bundle path
  await build({
    entryPoints: ["src/main/index.ts"],
    bundle: true,
    outfile: "dist/main/index.js",
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: true,
    external: [
      "electron",
      "electron-store",
      "electron-updater",
      "brosh",
      "ws",
      "posthog-node",
      "@huggingface/transformers",
      "chokidar",
      "cli-highlight",
    ],
    banner: {
      js: [
        `import { fileURLToPath as _bundled_fileURLToPath } from 'url';`,
        `import { dirname as _bundled_dirname } from 'path';`,
        `const __filename = _bundled_fileURLToPath(import.meta.url);`,
        `const __dirname = _bundled_dirname(__filename);`,
      ].join("\n"),
    },
  });
}

// Preload script is CJS, loaded separately by Electron — just copy it
cpSync("src/main/preload.cjs", "dist/main/preload.cjs");
