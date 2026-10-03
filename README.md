# Share Poster for Cider

Cider 插件：把当前歌曲做成一张 Apple 风格竖版海报（1080×1350），顶部清晰封面通过 Flowing 效果向下溶解进模糊背景，底部显示歌名 / 歌手 / 专辑。一键导出 PNG 并复制到剪贴板。

**(Requires Cider 2.5 or later, PluginKit v4)**

## 功能

- 四处入口：「分享歌曲海报」
  - 歌曲右键菜单（以右键命中的歌曲为准）
  - 沉浸式播放器菜单、主菜单、顶栏按钮（以上三处分享当前播放歌曲）
- 海报：封面羽化溶解 + 模糊 flow 背景（Spicetify full-screen 式：整封面 cover 铺满，高斯模糊 + 压暗 + 饱和度提升）
- Flow 随机化：底层取景滑动 ±6%，下半区由封面底部切片镜像 / 错位 / 微旋转重组后再模糊；点「重新生成」每次结果不同
- 复制：PNG 位图写入系统剪贴板；剪贴板不可用时自动降级为下载 PNG
- 无封面兜底：列表行 / 电台等拿不到封面时画深灰占位封面，流程不卡死；v3 请求与图片加载全链路超时

## 开发

```bash
npm install --legacy-peer-deps   # 模板的 @vitejs/plugin-vue@5 与 vite@8 有 peer 冲突
npm run dev      # Vite dev，Cider 里 Enable Vite 联调 (http://127.0.0.1:3058)
npm run build    # vue-tsc + vite build，产物 dist/plugin.js + dist/plugin.yml
```

## 安装（免 Vite）

1. `npm run build`
2. 新建目录并复制两个文件进去：
   - Cider 4 Windows：`%APPDATA%\sh.cider.dotnet\plugins\cider.share-poster\`
   - 旧版路径见模板说明（`%APPDATA%\C2Windows\plugins` / macOS / Linux）
   - 放入 `dist/plugin.js` 与 `dist/plugin.yml`
3. 重启 Cider（建议先关掉 Enable Vite，避免 dev 版与本地版菜单重复）

## 结构

- `src/main.ts` — 插件入口，四处菜单挂载 + 海报弹窗
- `src/components/SharePosterModal.vue` — 预览 + 重新生成 + 复制
- `src/utils/song.ts` — 歌曲信息归一化（host item → DOM 行抓取 → 在播 store 三级兜底）
- `src/utils/artwork.ts` — 封面 URL 展开 / CORS 加载 / v3 详情补全（library + catalog 双路由）
- `src/utils/poster.ts` — Canvas 海报绘制 + 剪贴板导出

## Preparing a ZIP package for the Cider Marketplace

Run `npm run prepare-marketplace`

Running this script will create a ZIP file in the `publish` directory that is ready to be uploaded to the Cider Marketplace.

To configure this plugin edit `src/plugin.config.ts`
