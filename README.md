# YSMParser-GUI

![image](images/image.png)

[YSMParser](https://github.com/OpenYSM/YSMParser) GUI，所有解析都在你的浏览器里完成，不上传任何文件。

在线使用：https://www.ysm.rip/parser/app

纯静态前端：**Next.js 静态导出（`output: "export"`，无 SSR、无服务端代码）**，解析器以 WASM 形式随站点一起发布。

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:3000> 即可使用。

## 构建

```bash
npm run build      # 静态导出 → out/
```

`out/` 就是全部产物（HTML / JS / CSS / WASM），没有任何服务端依赖。

## 部署到 Cloudflare

仓库根目录有 `wrangler.toml`，所以 Cloudflare 的构建系统按 **Workers 静态资源** 处理 ——
没有 Worker 脚本，只有 `out/` 里的静态文件（官方迁移指南就是这么走的：`pages_build_output_dir` → `assets.directory`）。

控制台（Git 集成）：

| 配置项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node.js version | `22`（最低 `20.19`） |

`wrangler.toml` 指路：

```toml
[assets]
directory = "./out"
html_handling = "auto-trailing-slash"
not_found_handling = "404-page"
```

`public/_headers`、`public/_redirects` 会被 Workers 原生解析（缓存规则、SPA 回退），不用另外配。

命令行部署：

```bash
npm run build
npm run deploy      # npx wrangler deploy
npm run preview     # npx wrangler dev，本地起 Worker 看 out/
```

## WASM 运行时

解析器不再运行时去 GitHub 拉，而是直接随站点发布在 `public/wasm/`：

| 文件 | 作用 |
| --- | --- |
| `YSMParser.js` | emscripten 胶水脚本（classic script，暴露全局 `YSMParserModule`） |
| `YSMParser.wasm` | 解析器二进制（约 1.1 MB） |
| `version.json` | 版本号 / 校验和，由同步脚本写入 |
| `LICENSE.txt` | 上游许可证 |

加载逻辑在 `src/lib/ysm-wasm.ts`：胶水脚本从本站同源加载，二进制通过 emscripten 的 `instantiateWasm` 钩子边下边实例化，所以有下载进度、也能取消。

### 更新解析器版本

```bash
npm run sync:wasm           # 拉最新 release
npm run sync:wasm v0.3.6    # 指定 tag
```

脚本会从 GitHub Release 下载 `*-wasm-web.tar.gz`，解包出 `YSMParser.js` / `YSMParser.wasm` 写进 `public/wasm/`，同时更新 `version.json`。提交后重新部署即可。

## 鸣谢

- **TartaricAcid**: 创建了YesSteveModel。
- **[Blockbench](https://www.blockbench.net/)：** 本项目模型渲染与动画部分移植自Blockbench代码。
