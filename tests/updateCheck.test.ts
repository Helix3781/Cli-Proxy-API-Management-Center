import { describe, expect, test } from 'bun:test';
import {
  EMPTY_SNAPSHOT,
  buildPanelCompareUrl,
  compareVersions,
  parseVersionSegments,
  pickLatestStableRelease,
  resolveSnapshotStatuses,
  resolveUpdateStatus,
  sanitizeSnapshot,
} from '@/features/updateCheck/updateCheck';

describe('parseVersionSegments', () => {
  test('parses plain and v-prefixed versions', () => {
    expect(parseVersionSegments('8.0.4')).toEqual([8, 0, 4]);
    expect(parseVersionSegments('v8.0.4')).toEqual([8, 0, 4]);
    expect(parseVersionSegments('v1.25.0')).toEqual([1, 25, 0]);
  });

  test('keeps numeric segments of prerelease tags', () => {
    expect(parseVersionSegments('1.25.0-beta.1')).toEqual([1, 25, 0, 1]);
  });

  test('returns null for unparseable input', () => {
    expect(parseVersionSegments('')).toBeNull();
    expect(parseVersionSegments('   ')).toBeNull();
    expect(parseVersionSegments(null)).toBeNull();
    expect(parseVersionSegments(undefined)).toBeNull();
    expect(parseVersionSegments('dev')).toBeNull();
  });
});

describe('compareVersions', () => {
  test('detects newer, older and equal', () => {
    expect(compareVersions('v8.0.5', '8.0.4')).toBe(1);
    expect(compareVersions('v8.0.4', '8.0.5')).toBe(-1);
    expect(compareVersions('v8.0.4', '8.0.4')).toBe(0);
  });

  test('pads missing segments with zero', () => {
    expect(compareVersions('1.25', '1.25.0')).toBe(0);
    expect(compareVersions('1.25.1', '1.25')).toBe(1);
  });

  test('multi-digit segments beat single-digit ones (no string compare)', () => {
    // 字符串比较会把 '1.9.3' 判成比 '1.25.0' 新，这是版本比对最经典的坑
    expect(compareVersions('1.25.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.9.3', '1.25.0')).toBe(-1);
  });

  test('returns null when either side is unparseable', () => {
    expect(compareVersions('v8.0.4', 'dev')).toBeNull();
    expect(compareVersions('', '8.0.4')).toBeNull();
  });
});

describe('resolveUpdateStatus', () => {
  test('failed fetch always wins, even if a stale latest is present', () => {
    // 取数失败时必须报 error，不能拿旧缓存伪装成「已是最新」
    expect(resolveUpdateStatus({ current: '8.0.4', latest: '8.0.4', failed: true })).toBe('error');
  });

  test('missing latest degrades to unknown, never to latest', () => {
    expect(resolveUpdateStatus({ current: '8.0.4', latest: '' })).toBe('unknown');
    expect(resolveUpdateStatus({ current: '8.0.4', latest: null })).toBe('unknown');
  });

  test('unparseable current version reports unknown instead of update', () => {
    expect(resolveUpdateStatus({ current: 'dev', latest: 'v1.25.0' })).toBe('unknown');
  });

  test('reports update / latest correctly', () => {
    expect(resolveUpdateStatus({ current: '8.0.3', latest: 'v8.0.4' })).toBe('update');
    expect(resolveUpdateStatus({ current: '8.0.4', latest: 'v8.0.4' })).toBe('latest');
    // 本地 fork 版本号高于上游时不算「有更新」
    expect(resolveUpdateStatus({ current: '8.0.9', latest: 'v8.0.4' })).toBe('latest');
  });
});

describe('pickLatestStableRelease', () => {
  test('skips prereleases', () => {
    const picked = pickLatestStableRelease([
      { tagName: 'v2.0.0-beta.1', prerelease: true },
      { tagName: 'v1.25.0', prerelease: false },
      { tagName: 'v1.24.2', prerelease: false },
    ]);
    expect(picked?.tagName).toBe('v1.25.0');
  });

  test('does not trust server ordering', () => {
    const picked = pickLatestStableRelease([
      { tagName: 'v1.9.3', prerelease: false },
      { tagName: 'v1.25.0', prerelease: false },
    ]);
    expect(picked?.tagName).toBe('v1.25.0');
  });

  test('returns null for empty or all-prerelease lists', () => {
    expect(pickLatestStableRelease([])).toBeNull();
    expect(pickLatestStableRelease([{ tagName: 'v2.0.0-rc1', prerelease: true }])).toBeNull();
  });
});

describe('sanitizeSnapshot', () => {
  test('rejects garbage and falls back to the empty snapshot', () => {
    expect(sanitizeSnapshot(null)).toEqual(EMPTY_SNAPSHOT);
    expect(sanitizeSnapshot('nope')).toEqual(EMPTY_SNAPSHOT);
    expect(sanitizeSnapshot(42)).toEqual(EMPTY_SNAPSHOT);
  });

  test('drops wrongly typed fields instead of propagating them', () => {
    // localStorage 可能被旧版本面板写坏，脏数据不能流进 UI
    expect(
      sanitizeSnapshot({
        backendLatest: 8,
        panelLatest: 'v1.25.0',
        checkedAt: null,
        backendFailed: 'yes',
        panelFailed: true,
      })
    ).toEqual({
      backendLatest: '',
      panelLatest: 'v1.25.0',
      checkedAt: '',
      backendFailed: false,
      panelFailed: true,
    });
  });
});

describe('resolveSnapshotStatuses', () => {
  test('resolves backend and panel independently', () => {
    // 面板检查失败不该把后端也拖成 error
    const statuses = resolveSnapshotStatuses(
      {
        backendLatest: 'v8.0.5',
        panelLatest: '',
        checkedAt: '2026-09-30T22:00:00.000Z',
        backendFailed: false,
        panelFailed: true,
      },
      { backendCurrent: '8.0.4', panelCurrent: 'v1.25.0' }
    );
    expect(statuses.backend).toBe('update');
    expect(statuses.panel).toBe('error');
  });
});

describe('buildPanelCompareUrl', () => {
  test('builds a compare link between current and latest', () => {
    expect(buildPanelCompareUrl('1.24.2', 'v1.25.0')).toBe(
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/compare/1.24.2...1.25.0'
    );
  });

  test('strips the v prefix from both ends', () => {
    expect(buildPanelCompareUrl('v1.24.2', 'v1.25.0')).toBe(
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/compare/1.24.2...1.25.0'
    );
  });

  test('falls back to the releases page when either side is missing', () => {
    expect(buildPanelCompareUrl('', 'v1.25.0')).toBe(
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases'
    );
    expect(buildPanelCompareUrl('1.24.2', '')).toBe(
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases'
    );
    expect(buildPanelCompareUrl(undefined, undefined)).toBe(
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases'
    );
  });

  test('falls back to the releases page when versions are equal', () => {
    // compare/1.25.0...1.25.0 是空 diff，没意义
    expect(buildPanelCompareUrl('v1.25.0', '1.25.0')).toBe(
      'https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases'
    );
  });
});
