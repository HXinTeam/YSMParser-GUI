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

## 部署到 Cloudflare Pages

控制台（Git 集成）：

| 配置项 | 值 |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `out` |
| Node.js version | `22`（最低 `20.19`） |

或者用 Wrangler CLI（仓库里的 `wrangler.toml` 已写好 `pages_build_output_dir = "out"`）：

```bash
npx wrangler pages deploy out --project-name ysmparser-gui
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
