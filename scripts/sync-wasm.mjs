#!/usr/bin/env node
/**
 * Pulls the official YSMParser `wasm-web` release and unpacks it into
 * `public/wasm/`, so the app can serve the parser from its own origin.
 *
 *   node scripts/sync-wasm.mjs           # latest release
 *   node scripts/sync-wasm.mjs v0.3.6    # pinned tag
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const REPO = "OpenYSM/YSMParser";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "wasm");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, init = {}, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "ysmparser-gui-sync",
          ...init.headers,
        },
      });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function resolveTag(explicit) {
  if (explicit) return explicit;
  const res = await fetchWithRetry(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) throw new Error(`无法获取最新版本 (HTTP ${res.status})`);
  const json = await res.json();
  if (!json.tag_name) throw new Error("最新版本信息无效");
  return json.tag_name;
}

function untar(buf) {
  const files = new Map();
  const dec = new TextDecoder();
  let offset = 0;
  let longName = null;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    offset += 512;

    let empty = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break;

    const rawName = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, "");
    const prefix = dec.decode(header.subarray(345, 500)).replace(/\0.*$/, "");
    const sizeField = dec
      .decode(header.subarray(124, 136))
      .replace(/[^0-7]/g, "");
    const size = sizeField ? parseInt(sizeField, 8) : 0;
    const typeflag = String.fromCharCode(header[156]);

    const data = buf.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      longName = dec.decode(data).replace(/\0.*$/, "");
      continue;
    }

    const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    longName = null;

    if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
      files.set(name.replace(/^\.\//, ""), data);
    }
  }

  return files;
}

async function main() {
  const tag = await resolveTag(process.argv[2]);
  console.log(`[sync-wasm] tag = ${tag}`);

  const relRes = await fetchWithRetry(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`,
  );
  if (!relRes.ok) throw new Error(`release not found (${relRes.status})`);
  const release = await relRes.json();
  const asset = (release.assets ?? []).find((a) => /wasm-web.*\.tar\.gz$/.test(a.name));
  if (!asset) throw new Error("wasm-web asset not found");

  const dl = await fetchWithRetry(asset.browser_download_url, { redirect: "follow" });
  if (!dl.ok) throw new Error(`download failed (${dl.status})`);
  const tar = gunzipSync(Buffer.from(await dl.arrayBuffer()));
  const files = untar(tar);

  const pick = (ext) => {
    for (const [name, data] of files) {
      if (name.toLowerCase().endsWith(ext)) return { name, data };
    }
    return null;
  };

  const js = pick(".js");
  const wasm = pick(".wasm");
  if (!js || !wasm) throw new Error("发布包缺少 .js / .wasm");

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "YSMParser.js"), js.data);
  await writeFile(join(OUT_DIR, "YSMParser.wasm"), wasm.data);

  const license = files.get("LICENSE.txt") ?? files.get("./LICENSE.txt");
  if (license) await writeFile(join(OUT_DIR, "LICENSE.txt"), license);

  const version = {
    tag,
    asset: asset.name,
    wasmSha256: createHash("sha256").update(wasm.data).digest("hex"),
    syncedAt: new Date().toISOString(),
  };
  await writeFile(join(OUT_DIR, "version.json"), `${JSON.stringify(version, null, 2)}\n`);

  console.log(
    `[sync-wasm] wrote ${js.name} (${js.data.byteLength} B) and ${wasm.name} (${wasm.data.byteLength} B) to public/wasm/`,
  );
  console.log(`[sync-wasm] version = ${version.tag} sha256 = ${version.wasmSha256.slice(0, 16)}…`);
}

main().catch((err) => {
  console.error(`[sync-wasm] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
