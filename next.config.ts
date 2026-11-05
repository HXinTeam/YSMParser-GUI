import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 纯静态导出：产物是 out/ 目录，直接丢给 Cloudflare Pages 就能跑，
  // 没有任何服务端代码（原来的 /api/ysm-wasm 路由已删除）。
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
