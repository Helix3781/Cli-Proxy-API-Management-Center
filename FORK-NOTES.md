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

**版本显示优化：**
- 当前版本下方显示最新版本（纵向排列）
- 自动检测并标注「本地修改」标识（版本号含 `-g` 或 `+` 时显示）

### 对上游文件的改动（合并冲突面）

只有 2 个文件、共 +13/−4 行：

- `src/pages/SystemPage.tsx` — 加 1 个 import + 1 行 `<UpdateCheckCard />`
- `src/i18n/index.ts` — 注册 `updateCheck` 命名空间

> 上游那颗小的「检查更新」按钮**故意保留没删**。删了会连带孤立 `handleVersionCheck` /
> `checkingVersion` / `versionApi` / `compareVersions` / `parseVersionSegments`，
> 反而把冲突面扩大。

---

## 2. 无损升级机制

### 面板无损升级

**问题：** 后端 `updater.go` 会自动从 GitHub 下载最新 `management.html` 覆盖本地文件，导致 fork 修改丢失。

**解决方案：** 修改 `~/cliproxyapi-deploy/src/internal/managementasset/updater.go`，添加 `isOfficialRelease()` 检测：

1. 计算本地 `management.html` 的 SHA256
2. 与 GitHub 最新 release 的 digest 比较
3. 如果不匹配，遍历最近 10 个 releases，检查本地文件是否与任何一个历史版本匹配
4. 如果匹配 → 官方版本，可以安全覆盖
5. 如果不匹配 → 用户修改过，跳过自动更新

**代码位置：** `~/cliproxyapi-deploy/src/internal/managementasset/updater.go` 中的 `isOfficialRelease()` 函数

### CLI 无损升级

**问题：** CLI 是编译好的二进制文件，无法直接「无损升级」。

**解决方案：**
1. 版本检测页面自动检测并标注「本地修改」标识（版本号含 `-g` 或 `+` 时显示）
2. 升级后需要重新编译（源码在 `~/cliproxyapi-deploy/src/`）
3. **必须用 ARM64 Docker 编译**（容器 `cli-proxyapi-plus:8.0.x` 是 arm64 镜像，
   宿主编译出的 Mach-O 或 amd64 ELF 都会 `exec format error`）：

```bash
cd ~/cliproxyapi-deploy/src
COMMIT=$(git rev-parse --short HEAD)
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker run --rm --platform linux/arm64 -v ~/cliproxyapi-deploy/src:/src -w /src \
  golang:1.26 bash -c "\
    CGO_ENABLED=1 GOOS=linux GOARCH=arm64 \
    go build -ldflags '-X main.Version=<如 v8.0.20> -X main.Commit=$COMMIT -X main.BuildDate=$BUILT_AT' \
    -o CLIProxyAPIPlus ./cmd/server/"
docker cp ~/cliproxyapi-deploy/src/CLIProxyAPIPlus cli-proxy-api:/CLIProxyAPI/CLIProxyAPIPlus
docker restart cli-proxy-api
docker exec cli-proxy-api /CLIProxyAPI/CLIProxyAPIPlus --version   # 验证版本号
```

> ⚠️ **`-ldflags` 注入版本号必不可少**：不注入的话 `main.Version` 默认为 `dev`，
> 面板读响应头 `X-CPA-VERSION` 会显示 `dev`，版本检查卡片全部失效。

---

## 3. 合并上游更新

```bash
cd ~/cpa-mc-fork
git fetch upstream
git merge upstream/main        # 或 git rebase upstream/main
bun install                    # 上游可能改了依赖
bun run verify                 # 测试 + lint + tsc + build 一条龙
```

冲突基本只会出现在上面那 2 个文件。自研代码都在 `src/features/updateCheck/`
和 `src/i18n/locales/updateCheck/`，上游不会碰，正常不会冲突。

---

## 4. 构建与部署

构建产物是单文件 HTML（`vite-plugin-singlefile`），约 2.8 MB：

```bash
cd ~/cpa-mc-fork
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

## 5. 后续自研功能往哪放

新功能一律新建 `src/features/<name>/`，i18n 走独立命名空间 `src/i18n/locales/<name>/`，
对上游文件只加「import + 一行挂载」。保持这个纪律，merge upstream 才不会痛。

---

## 6. 本地修改标识说明

版本检测页面会自动检测并标注「本地修改」标识：

- **后端（CLI）：** 版本号含 `-g` 或 `+` 时显示（如 `v8.0.16-2-ga2976eb`）
- **面板：** 版本号含 `-g` 或 `+` 时显示（如 `v1.25.4-2-gfbb5bf4`）

这个标识提醒用户：当前版本包含本地修改，升级时需要保留这些修改。
