#!/usr/bin/env node

/**
 * Downloads the brosh-ky ML model files from HuggingFace.
 * Uses only Node.js built-in modules (no extra dependencies).
 *
 * Usage: node scripts/download-models.js
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'models', 'brosh-ky');
const BASE_URL = 'https://huggingface.co/elleryfamilia/broshky/resolve/main';

const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model.onnx',
  'onnx/model.onnx.data',
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = (reqUrl) => {
      https.get(reqUrl, (res) => {
        // Follow redirects (HuggingFace uses 302s to CDN)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const location = res.headers.location;
          // Resolve relative redirects against the current URL
          const nextUrl = location.startsWith('http') ? location : new URL(location, reqUrl).href;
          request(nextUrl);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 1024 * 1024) {
            const pct = totalBytes ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : '?';
            process.stdout.write(`\r  ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          if (totalBytes > 1024 * 1024) process.stdout.write('\n');
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        reject(err);
      });
    };
    request(url);
  });
}

async function main() {
  console.log(`Downloading brosh-ky model to ${MODELS_DIR}\n`);
  mkdirSync(MODELS_DIR, { recursive: true });

  let skipped = 0;
  let downloaded = 0;

  for (const file of FILES) {
    const dest = join(MODELS_DIR, file);
    if (existsSync(dest) && statSync(dest).size > 0) {
      console.log(`  [skip] ${file} (already exists)`);
      skipped++;
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    const url = `${BASE_URL}/${file}`;
    console.log(`  [download] ${file}`);
    await download(url, dest);
    downloaded++;
  }

  console.log(`\nDone. ${downloaded} downloaded, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(`\nFailed to download models: ${err.message}`);
  process.exit(1);
});
