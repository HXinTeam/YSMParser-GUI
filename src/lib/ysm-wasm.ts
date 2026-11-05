/**
 * YSMParser WASM runtime loader.
 *
 * The parser ships with the site as static files:
 *   /wasm/YSMParser.js    — emscripten glue (classic script, sets `YSMParserModule`)
 *   /wasm/YSMParser.wasm  — the parser binary
 *   /wasm/version.json    — tag / checksums, written by `npm run sync:wasm`
 *
 * No server is involved: the glue is loaded from our own origin and the binary
 * is streamed in through emscripten's `instantiateWasm` hook so we can report
 * download progress and support cancellation.
 */

export type WasmStage =
  | "fetching-meta"
  | "loading-script"
  | "downloading"
  | "instantiating"
  | "ready";

export interface WasmProgress {
  stage: WasmStage;
  tag?: string | null;
  loaded?: number;
  total?: number;
}

export interface YSMModuleConfig {
  print?: (s: string) => void;
  printErr?: (s: string) => void;
}

export interface LoadOptions {
  onProgress?: (info: WasmProgress) => void;
  config?: YSMModuleConfig;
  signal?: AbortSignal;
}

export interface YSMModule {
  FS: {
    mkdir: (path: string) => void;
    writeFile: (path: string, data: Uint8Array) => void;
    readdir: (path: string) => string[];
    readFile: (path: string) => Uint8Array;
    stat: (path: string) => { mode: number };
    unlink: (path: string) => void;
    rmdir: (path: string) => void;
    isDir: (mode: number) => boolean;
    analyzePath: (path: string) => { exists: boolean };
  };
  callMain: (args: string[]) => number | undefined;
}

interface YSMFactoryOptions {
  noInitialRun: boolean;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  locateFile?: (path: string, prefix: string) => string;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    onInstantiated: (instance: WebAssembly.Instance) => void,
  ) => void;
}

type YSMFactory = (opts: YSMFactoryOptions) => Promise<YSMModule>;

interface GlobalWithFactory {
  YSMParserModule?: YSMFactory;
  Module?: YSMFactory;
}

export interface WasmVersionInfo {
  tag: string;
  asset?: string;
  wasmSha256?: string;
  syncedAt?: string;
}

const WASM_DIR = "/wasm/";
const GLUE_URL = `${WASM_DIR}YSMParser.js`;
const BINARY_URL = `${WASM_DIR}YSMParser.wasm`;
const VERSION_URL = `${WASM_DIR}version.json`;

let pending: Promise<{ Module: YSMModule; tag: string | null }> | null = null;

function abortError(): DOMException {
  return new DOMException("操作已取消", "AbortError");
}

async function fetchVersionInfo(signal?: AbortSignal): Promise<WasmVersionInfo | null> {
  try {
    const res = await fetch(VERSION_URL, { signal, cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as WasmVersionInfo;
  } catch {
    return null;
  }
}

function loadGlueScript(signal?: AbortSignal): Promise<YSMFactory> {
  return new Promise<YSMFactory>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const script = document.createElement("script");
    script.src = GLUE_URL;
    script.async = true;
    script.onload = () => {
      const g = globalThis as GlobalWithFactory;
      const factory = g.YSMParserModule ?? g.Module;
      if (typeof factory !== "function") {
        reject(new Error("YSMParserModule 工厂函数未找到"));
        return;
      }
      resolve(factory);
    };
    script.onerror = () => reject(new Error("YSMParser.js 加载失败"));
    document.head.appendChild(script);
    signal?.addEventListener("abort", () => {
      script.remove();
      reject(abortError());
    });
  });
}

async function downloadWasm(
  url: string,
  onProgress: (loaded: number, total: number | undefined) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal, credentials: "same-origin" });
  if (!res.ok) throw new Error(`下载 wasm 失败 (HTTP ${res.status})`);

  const lenHeader = res.headers.get("content-length");
  const total = lenHeader ? Number(lenHeader) : undefined;

  if (!res.body) {
    const buffer = await res.arrayBuffer();
    onProgress(buffer.byteLength, total ?? buffer.byteLength);
    return buffer;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress(received, total);
    }
  }
  const buffer = new ArrayBuffer(received);
  const out = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

export async function loadYSMWasm(
  opts: LoadOptions = {},
): Promise<{ Module: YSMModule; tag: string | null }> {
  if (pending) return pending;

  const { onProgress, config, signal } = opts;
  const emit = (info: WasmProgress) => onProgress?.(info);

  pending = (async () => {
    emit({ stage: "fetching-meta" });

    const versionInfo = await fetchVersionInfo(signal);
    const tag = versionInfo?.tag ?? null;

    emit({ stage: "loading-script", tag });
    const factory = await loadGlueScript(signal);

    emit({ stage: "downloading", tag });

    let rejectFailure: ((reason: unknown) => void) | null = null;
    const failure = new Promise<never>((_, reject) => {
      rejectFailure = reject;
    });

    const modulePromise = factory({
      noInitialRun: true,
      print: config?.print,
      printErr: config?.printErr,
      locateFile: (path: string) =>
        new URL(path, new URL(WASM_DIR, window.location.href)).href,
      instantiateWasm: (imports, onInstantiated) => {
        void (async () => {
          const bytes = await downloadWasm(
            BINARY_URL,
            (loaded, total) => emit({ stage: "downloading", tag, loaded, total }),
            signal,
          );
          emit({ stage: "instantiating", tag });
          const wasmModule = await WebAssembly.compile(bytes);
          onInstantiated(new WebAssembly.Instance(wasmModule, imports));
        })().catch((err: unknown) => {
          rejectFailure?.(err);
        });
      },
    });

    const Module = await Promise.race([modulePromise, failure]);

    emit({ stage: "ready", tag });
    return { Module, tag };
  })().catch((err: unknown) => {
    pending = null;
    throw err;
  });

  return pending;
}
