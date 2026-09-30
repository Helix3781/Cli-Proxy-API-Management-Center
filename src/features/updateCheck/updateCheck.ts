/**
 * 更新检查 —— 纯逻辑层（无 React / 无网络）
 *
 * ⚠️ FORK 自研模块：上游 router-for-me/Cli-Proxy-API-Management-Center 不存在此目录。
 * 所有本地自研功能集中在 src/features/updateCheck/ 下，SystemPage.tsx 只增加
 * 「一行 import + 一行渲染」，以便后续 `git merge upstream/main` 时冲突面最小。
 */

/** 单个组件的更新状态 */
export type UpdateStatus = 'unknown' | 'latest' | 'update' | 'error';

/** 一次完整检查的结果快照（可序列化，用于 localStorage 持久化） */
export interface UpdateCheckSnapshot {
  /** 后端 CLIProxyAPI 最新版本号，空串表示未取到 */
  backendLatest: string;
  /** 管理中心面板最新版本号，空串表示未取到 */
  panelLatest: string;
  /** 检查时刻（ISO 字符串），空串表示从未检查 */
  checkedAt: string;
  /** 后端检查是否失败 */
  backendFailed: boolean;
  /** 面板检查是否失败 */
  panelFailed: boolean;
}

export const EMPTY_SNAPSHOT: UpdateCheckSnapshot = {
  backendLatest: '',
  panelLatest: '',
  checkedAt: '',
  backendFailed: false,
  panelFailed: false,
};

/** 面板上游仓库 slug（fork 后仍跟踪上游 release，才能知道官方有无新版） */
export const PANEL_REPO_SLUG = 'router-for-me/Cli-Proxy-API-Management-Center';
export const PANEL_RELEASES_URL =
  'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases';
export const PANEL_COMPARE_URL =
  'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/compare';
export const BACKEND_RELEASES_URL = 'https://github.com/router-for-me/CLIProxyAPI/releases';

/**
 * 把 "v8.0.4" / "1.25.0-beta.1" 解析成 [8,0,4] / [1,25,0,1]。
 * 无法解析返回 null（调用方据此降级为「无法比对」而非误报有更新）。
 */
export const parseVersionSegments = (version?: string | null): number[] | null => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

/**
 * 比较两个版本号。
 * @returns 1 = latest 更新，-1 = current 更新，0 = 相同，null = 有一方无法解析
 */
export const compareVersions = (
  latest?: string | null,
  current?: string | null
): 1 | -1 | 0 | null => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i += 1) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

/**
 * 由「当前版本 / 最新版本 / 是否取数失败」推导展示状态。
 *
 * 优先级：取数失败 > 无法比对 > 有新版本 > 已是最新。
 * 取不到最新版本时返回 unknown 而不是 latest —— 宁可显示「未检查」，
 * 也不要给用户一个「已是最新」的假安心。
 */
export const resolveUpdateStatus = (input: {
  current?: string | null;
  latest?: string | null;
  failed?: boolean;
}): UpdateStatus => {
  if (input.failed) return 'error';
  const latest = (input.latest ?? '').trim();
  if (!latest) return 'unknown';
  const comparison = compareVersions(latest, input.current);
  if (comparison === null) return 'unknown';
  return comparison > 0 ? 'update' : 'latest';
};

/** GitHub release 列表里挑最新的正式版（跳过 prerelease / draft） */
export const pickLatestStableRelease = <
  T extends { tagName: string; prerelease?: boolean },
>(releases: T[]): T | null => {
  if (!Array.isArray(releases) || releases.length === 0) return null;
  const stable = releases.filter((release) => release && !release.prerelease && release.tagName);
  if (stable.length === 0) return null;
  // GitHub /releases 默认按发布时间倒序，但仍显式排序一次，避免依赖服务端顺序。
  // compareVersions(b, a) > 0 表示 b 更新 → 返回正数把 a 排到 b 之后，即降序（最新在前）。
  const sorted = [...stable].sort((a, b) => {
    const result = compareVersions(b.tagName, a.tagName);
    return result === null ? 0 : result;
  });
  return sorted[0];
};

/** 从快照推导后端 / 面板各自的状态，供 UI 直接消费 */
export const resolveSnapshotStatuses = (
  snapshot: UpdateCheckSnapshot,
  versions: { backendCurrent?: string | null; panelCurrent?: string | null }
): { backend: UpdateStatus; panel: UpdateStatus } => ({
  backend: resolveUpdateStatus({
    current: versions.backendCurrent,
    latest: snapshot.backendLatest,
    failed: snapshot.backendFailed,
  }),
  panel: resolveUpdateStatus({
    current: versions.panelCurrent,
    latest: snapshot.panelLatest,
    failed: snapshot.panelFailed,
  }),
});

/**
 * 拼「当前面板版本 → 上游最新版本」的 GitHub compare 链接。
 * 任一版本号缺失时退回 releases 列表页，避免生成 `compare/...` 这种残缺地址。
 */
export const buildPanelCompareUrl = (current?: string | null, latest?: string | null): string => {
  const from = (current ?? '').trim().replace(/^v/i, '');
  const to = (latest ?? '').trim().replace(/^v/i, '');
  if (!from || !to) return PANEL_RELEASES_URL;
  if (from === to) return PANEL_RELEASES_URL;
  return `${PANEL_COMPARE_URL}/${from}...${to}`;
};

/** 校验从 localStorage 读回来的快照，字段缺失 / 类型不对一律退回空快照 */export const sanitizeSnapshot = (input: unknown): UpdateCheckSnapshot => {
  if (!input || typeof input !== 'object') return EMPTY_SNAPSHOT;
  const record = input as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  return {
    backendLatest: str(record.backendLatest),
    panelLatest: str(record.panelLatest),
    checkedAt: str(record.checkedAt),
    backendFailed: record.backendFailed === true,
    panelFailed: record.panelFailed === true,
  };
};
