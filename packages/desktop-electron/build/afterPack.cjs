// afterPack hook for electron-builder
// Strips cross-platform native binaries to reduce package size.
//
// Target platforms: macOS (x64, arm64), Linux (x64, arm64)

const fs = require("fs");
const path = require("path");

// electron-builder arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_MAP = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
};

function getResourcesDir(context) {
  // macOS: <appOutDir>/<productName>.app/Contents/Resources/
  // Linux/Windows: <appOutDir>/resources/
  if (context.electronPlatformName === "darwin") {
    const appName =
      context.packager.appInfo.productFilename || context.packager.appInfo.name;
    return path.join(context.appOutDir, `${appName}.app`, "Contents", "Resources");
  }
  return path.join(context.appOutDir, "resources");
}

function rmSyncSafe(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  }
  return false;
}

function dirSize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(entryPath);
    } else {
      total += fs.statSync(entryPath).size;
    }
  }
  return total;
}

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

// With asar: false, modules are at app/node_modules/ instead of app.asar.unpacked/node_modules/
function getNodeModulesDir(resourcesDir) {
  // Try asar-unpacked path first (asar: true), then loose app dir (asar: false)
  const asarUnpacked = path.join(resourcesDir, "app.asar.unpacked/node_modules");
  if (fs.existsSync(asarUnpacked)) return asarUnpacked;
  const loose = path.join(resourcesDir, "app/node_modules");
  if (fs.existsSync(loose)) return loose;
  return null;
}

function stripOnnxruntimeNode(nodeModulesDir, platform, arch) {
  const onnxBinDir = path.join(
    nodeModulesDir,
    "onnxruntime-node/bin/napi-v3"
  );
  if (!fs.existsSync(onnxBinDir)) return 0;

  let removed = 0;
  for (const platformDir of fs.readdirSync(onnxBinDir)) {
    const platformPath = path.join(onnxBinDir, platformDir);
    if (!fs.statSync(platformPath).isDirectory()) continue;

    if (platformDir !== platform) {
      const size = dirSize(platformPath);
      rmSyncSafe(platformPath);
      console.log(`    removed onnxruntime-node/${platformDir} (${formatMB(size)})`);
      removed += size;
    } else {
      for (const archDir of fs.readdirSync(platformPath)) {
        const archPath = path.join(platformPath, archDir);
        if (!fs.statSync(archPath).isDirectory()) continue;
        if (archDir !== arch) {
          const size = dirSize(archPath);
          rmSyncSafe(archPath);
          console.log(`    removed onnxruntime-node/${platformDir}/${archDir} (${formatMB(size)})`);
          removed += size;
        }
      }
    }
  }
  return removed;
}

function stripOnnxruntimeWeb(nodeModulesDir) {
  // onnxruntime-web is only needed for browser/WASM contexts.
  // We use onnxruntime-node for main process ML inference, so this is dead weight.
  const loc = path.join(nodeModulesDir, "onnxruntime-web");
  const size = dirSize(loc);
  if (rmSyncSafe(loc)) {
    console.log(`    removed onnxruntime-web (${formatMB(size)})`);
    return size;
  }
  return 0;
}

function stripSharpPlatformModules(nodeModulesDir, platform, arch) {
  if (!fs.existsSync(nodeModulesDir)) return 0;

  const targetSuffix = `${platform}-${arch}`;
  let removed = 0;

  for (const dir of fs.readdirSync(nodeModulesDir)) {
    if (!dir.startsWith("@img")) continue;
    const imgDir = path.join(nodeModulesDir, dir);
    if (!fs.statSync(imgDir).isDirectory()) continue;
    for (const sub of fs.readdirSync(imgDir)) {
      const subPath = path.join(imgDir, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;
      if (!sub.startsWith("sharp-")) continue;
      if (!sub.includes(targetSuffix)) {
        const size = dirSize(subPath);
        rmSyncSafe(subPath);
        console.log(`    removed @img/${sub} (${formatMB(size)})`);
        removed += size;
      }
    }
  }
  return removed;
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH_MAP[context.arch] || "x64";
  const resourcesDir = getResourcesDir(context);

  console.log(`\n  afterPack: stripping binaries for ${platform}/${arch}`);
  console.log(`  afterPack: resources at ${resourcesDir}`);

  const nodeModulesDir = getNodeModulesDir(resourcesDir);
  if (!nodeModulesDir) {
    console.log(`  afterPack: no node_modules found, skipping`);
    return;
  }
  console.log(`  afterPack: node_modules at ${nodeModulesDir}`);

  let totalSaved = 0;

  totalSaved += stripOnnxruntimeNode(nodeModulesDir, platform, arch);
  totalSaved += stripOnnxruntimeWeb(nodeModulesDir);
  totalSaved += stripSharpPlatformModules(nodeModulesDir, platform, arch);

  console.log(`  afterPack: total saved ${formatMB(totalSaved)}\n`);
};
