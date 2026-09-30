# Fork 说明（自研改动清单）

这是 `router-for-me/Cli-Proxy-API-Management-Center` 的 fork，用于自研面板小功能。
**原则：自研代码尽量集中在新目录，对上游文件的改动压到最小，方便后续 merge upstream。**

- origin: `Helix3781/Cli-Proxy-API-Management-Center`
- upstream: `router-for-me/Cli-Proxy-API-Management-Center`

---

## 1. 已自研功能

### 更新检查卡片（中心信息页）

上游只在「CLI Proxy API 版本」旁有一个很小的 ghost 按钮，容易看不见。
fork 把它提升为一张独立卡片，同时检查**后端**和**面板**两条版本线。

| 位置 | 说明 |
|------|------|
| `src/features/updateCheck/updateCheck.ts` | 纯逻辑：版本解析 / 比较 / 状态判定 / compare 链接拼装，无 React 无网络 |
| `src/features/updateCheck/useUpdateCheck.ts` | hook：并发检查两条链，localStorage 缓存，进页面静默自动检查（6h 一次） |
| `src/features/updateCheck/UpdateCheckCard.tsx` | 卡片 UI |
| `src/features/updateCheck/UpdateCheckCard.module.scss` | 样式（badge 规格对齐 PluginStorePage） |
| `src/i18n/locales/updateCheck/{zh-CN,zh-TW,en,ru}.json` | 独立 i18n 命名空间 |
| `tests/updateCheck.test.ts` | 单测 |

**行为约定：只提示，不自动升级。** 检测到新版本时提示「请自行 merge upstream 后重新构建部署」。

### 对上游文件的改动（合并冲突面）

只有 2 个文件、共 +13/−4 行：

- `src/pages/SystemPage.tsx` — 加 1 个 import + 1 行 `<UpdateCheckCard />`
- `src/i18n/index.ts` — 注册 `updateCheck` 命名空间

> 上游那颗小的「检查更新」按钮**故意保留没删**。删了会连带孤立 `handleVersionCheck` /
> `checkingVersion` / `versionApi` / `compareVersions` / `parseVersionSegments`，
> 反而把冲突面扩大。

---

## 2. 合并上游更新

```bash
git fetch upstream
git merge upstream/main        # 或 git rebase upstream/main
bun install                    # 上游可能改了依赖
bun run verify                 # 测试 + lint + tsc + build 一条龙
```

冲突基本只会出现在上面那 2 个文件。自研代码都在 `src/features/updateCheck/`
和 `src/i18n/locales/updateCheck/`，上游不会碰，正常不会冲突。

---

## 3. 构建与部署

构建产物是单文件 HTML（`vite-plugin-singlefile`），约 2.8 MB：

```bash
bun run build                  # → dist/index.html
```

部署到本机 CLIProxyAPIPlus（容器 `cli-proxy-api`，`:8317`）：

```bash
cp dist/index.html ~/cliproxyapi-deploy/static/management.html
docker cp ~/cliproxyapi-deploy/static/management.html \
  cli-proxy-api:/CLIProxyAPI/static/management.html
```

**不需要重启容器** —— CPA 每次请求都从磁盘读 `management.html`，刷页面即生效。
部署后用 md5 三处对齐验证：`dist` / 宿主 `static` / 容器内 / `curl` 线上响应。

原版备份：`~/cliproxyapi-deploy/backup/management.html.upstream-orig`

### ⚠️ 未持久化的挂载

`~/cliproxyapi-deploy/docker-compose.yml` 目前**没有**挂载 `./static`，
`docker cp` 进去的文件在容器 recreate 后会丢。要长期生效需加一行：

```yaml
    volumes:
      - ./static:/CLIProxyAPI/static
```

加了之后必须 `docker compose up -d`（会短暂中断 CPA 服务），所以这一步按需再做。

---

## 4. 后续自研功能往哪放

新功能一律新建 `src/features/<name>/`，i18n 走独立命名空间 `src/i18n/locales/<name>/`，
对上游文件只加「import + 一行挂载」。保持这个纪律，merge upstream 才不会痛。
