/**
 * 更新检查 —— 数据层 Hook
 *
 * 两条独立的检查链，互不阻塞（一条失败不影响另一条显示）：
 *   后端 CLIProxyAPI : GET /v8/management/server/latest-version  → {"latest-version":"v8.0.4"}
 *   管理中心面板     : GitHub releases（经 CPA /requests/api-call 代理转发，
 *                      绕开浏览器 CORS，也避开本机直连 GitHub 的网络问题）
 *
 * 只做「提示」，不做自动升级 —— 升级由维护者自行 merge upstream。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore, useNotificationStore } from '@/stores';
import { versionApi } from '@/services/api';
import { fetchPluginReleaseVersions } from '@/features/plugins/pluginReleaseVersions';
import {
  EMPTY_SNAPSHOT,
  PANEL_REPO_SLUG,
  pickLatestStableRelease,
  resolveSnapshotStatuses,
  sanitizeSnapshot,
  type UpdateCheckSnapshot,
  type UpdateStatus,
} from './updateCheck';

const STORAGE_KEY = 'cli-proxy-update-check';
/** 自动检查的最小间隔：6 小时。避免每次进页面都打一次 GitHub */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const readSnapshot = (): UpdateCheckSnapshot => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SNAPSHOT;
    return sanitizeSnapshot(JSON.parse(raw));
  } catch {
    return EMPTY_SNAPSHOT;
  }
};

const writeSnapshot = (snapshot: UpdateCheckSnapshot): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级，检查功能仍可用，只是不记忆
  }
};

/** 从 /server/latest-version 的多种可能字段名里取版本号 */
const extractBackendLatest = (data: unknown): string => {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  const candidate =
    record['latest-version'] ?? record.latest_version ?? record.latest ?? record.version ?? '';
  return typeof candidate === 'string' ? candidate.trim() : String(candidate ?? '').trim();
};

/**
 * 读当前版本号。
 * 渲染时用 store 的订阅值；事件回调用 getState() 取最新值 ——
 * 两者都不在渲染期写 ref，避免 react-hooks/refs 违例。
 */
const readPanelVersion = (): string => __APP_VERSION__ || '';

export interface UseUpdateCheckResult {
  snapshot: UpdateCheckSnapshot;
  backendStatus: UpdateStatus;
  panelStatus: UpdateStatus;
  /** 任一组件有新版本 —— 用于外层做角标提示 */
  hasUpdate: boolean;
  checking: boolean;
  /** 主动检查；silent=true 时不弹通知（自动检查用） */
  check: (options?: { silent?: boolean }) => Promise<void>;
}

export function useUpdateCheck(options: { autoCheck?: boolean } = {}): UseUpdateCheckResult {
  const { autoCheck = true } = options;
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const backendVersion = useAuthStore((state) => state.serverVersion) || '';

  const panelVersion = readPanelVersion();

  const [snapshot, setSnapshot] = useState<UpdateCheckSnapshot>(() => readSnapshot());
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const autoChecked = useRef(false);

  const check = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setChecking(true);

      let backendLatest = '';
      let panelLatest = '';
      // 不给初值：两个分支都会赋值，写初值反而是无用赋值
      let backendFailed: boolean;
      let panelFailed: boolean;

      // 两条链并行，各自吞掉异常 —— 面板版本取不到不该连累后端版本显示
      const [backendResult, panelResult] = await Promise.allSettled([
        versionApi.checkLatest(),
        fetchPluginReleaseVersions(PANEL_REPO_SLUG),
      ]);

      if (backendResult.status === 'fulfilled') {
        backendLatest = extractBackendLatest(backendResult.value);
        backendFailed = !backendLatest;
      } else {
        backendFailed = true;
      }

      if (panelResult.status === 'fulfilled') {
        const latest = pickLatestStableRelease(panelResult.value);
        panelLatest = latest?.tagName ?? '';
        panelFailed = !panelLatest;
      } else {
        panelFailed = true;
      }

      const next: UpdateCheckSnapshot = {
        backendLatest,
        panelLatest,
        checkedAt: new Date().toISOString(),
        backendFailed,
        panelFailed,
      };
      setSnapshot(next);
      writeSnapshot(next);

      if (!silent) {
        const statuses = resolveSnapshotStatuses(next, {
          backendCurrent: useAuthStore.getState().serverVersion || '',
          panelCurrent: readPanelVersion(),
        });
        const updates = [
          statuses.backend === 'update' ? next.backendLatest : '',
          statuses.panel === 'update' ? next.panelLatest : '',
        ].filter(Boolean);

        if (updates.length > 0) {
          showNotification(
            `发现新版本：${updates.map((version) => version.replace(/^v/i, '')).join(' / ')}`,
            'warning'
          );
        } else if (statuses.backend === 'error' && statuses.panel === 'error') {
          showNotification('检查更新失败：后端与面板版本均无法获取', 'error');
        } else if (statuses.backend === 'error' || statuses.panel === 'error') {
          showNotification('检查完成，但部分版本信息获取失败', 'warning');
        } else {
          showNotification('当前已是最新版本', 'success');
        }
      }

      setChecking(false);
      inFlight.current = false;
    },
    [showNotification]
  );

  // 进页面时静默自检一次：仅当已连接、本轮未检过、且距上次检查超过 6 小时
  useEffect(() => {
    if (!autoCheck || autoChecked.current) return;
    if (connectionStatus !== 'connected') return;

    const lastCheckedAt = snapshot.checkedAt ? Date.parse(snapshot.checkedAt) : NaN;
    const stale =
      !Number.isFinite(lastCheckedAt) || Date.now() - lastCheckedAt > AUTO_CHECK_INTERVAL_MS;
    if (!stale) return;

    autoChecked.current = true;
    void check({ silent: true });
    // snapshot.checkedAt 故意不进依赖：只在挂载/连接状态变化时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, connectionStatus, check]);

  const statuses = resolveSnapshotStatuses(snapshot, {
    backendCurrent: backendVersion,
    panelCurrent: panelVersion,
  });

  return {
    snapshot,
    backendStatus: statuses.backend,
    panelStatus: statuses.panel,
    hasUpdate: statuses.backend === 'update' || statuses.panel === 'update',
    checking,
    check,
  };
}
