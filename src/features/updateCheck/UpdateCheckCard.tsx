/**
 * 更新检查卡片（fork 自研）
 *
 * 上游把「检查更新」做成 API 版本号旁边的一个 ghost 小按钮，很容易被忽略。
 * 这里改成独立卡片：后端与面板两行并排，各自带状态徽标，有新版本时整行高亮。
 *
 * 版本显示：当前版本下方显示最新版本（纵向排列），并标注本地修改状态。
 * 只做提示，不触发任何升级动作 —— 升级由维护者自行 merge upstream 后重新构建。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { IconExternalLink, IconGithub } from '@/components/ui/icons';
import { useAuthStore } from '@/stores';
import { formatDateTimeValue } from '@/utils/format';
import { useUpdateCheck } from './useUpdateCheck';
import {
  BACKEND_RELEASES_URL,
  PANEL_RELEASES_URL,
  buildPanelCompareUrl,
  type UpdateStatus,
} from './updateCheck';
import styles from './UpdateCheckCard.module.scss';

const STATUS_BADGE_CLASS: Record<UpdateStatus, string> = {
  unknown: 'badge',
  latest: 'badgeSuccess',
  update: 'badgeWarning',
  error: 'badgeError',
};

interface RowDefinition {
  id: string;
  title: string;
  current: string;
  latest: string;
  status: UpdateStatus;
  releasesUrl: string;
  releasesLabel: string;
  hasLocalChanges: boolean;
}

export function UpdateCheckCard() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const backendVersion = serverVersion || '';
  const panelVersion = __APP_VERSION__ || '';

  const { snapshot, backendStatus, panelStatus, hasUpdate, checking, check } = useUpdateCheck({
    autoCheck: true,
  });

  const unknownVersionLabel = t('updateCheck:unknown_version');

  const rows = useMemo<RowDefinition[]>(
    () => [
      {
        id: 'backend',
        title: t('updateCheck:backend_title'),
        current: backendVersion,
        latest: snapshot.backendLatest,
        status: backendStatus,
        releasesUrl: BACKEND_RELEASES_URL,
        releasesLabel: t('updateCheck:backend_releases'),
        hasLocalChanges: backendVersion.includes('-g') || backendVersion.includes('+'),
      },
      {
        id: 'panel',
        title: t('updateCheck:panel_title'),
        current: panelVersion,
        latest: snapshot.panelLatest,
        status: panelStatus,
        releasesUrl: PANEL_RELEASES_URL,
        releasesLabel: t('updateCheck:panel_releases'),
        hasLocalChanges: panelVersion.includes('-g') || panelVersion.includes('+'),
      },
    ],
    [t, backendVersion, panelVersion, snapshot.backendLatest, snapshot.panelLatest, backendStatus, panelStatus]
  );

  const checkedAtLabel = snapshot.checkedAt
    ? t('updateCheck:checked_at', {
        time: formatDateTimeValue(snapshot.checkedAt, i18n.language) || snapshot.checkedAt,
      })
    : t('updateCheck:never_checked');

  // 面板落后于上游时，直接给出 compare 链接，省掉手动拼 diff 地址
  const panelCompareUrl = buildPanelCompareUrl(panelVersion, snapshot.panelLatest);

  const disabled = connectionStatus !== 'connected';

  return (
    <Card
      className={styles.card}
      title={t('updateCheck:title')}
      extra={
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void check()}
          loading={checking}
          disabled={disabled}
          title={t('updateCheck:check_button')}
          aria-label={t('updateCheck:check_button')}
        >
          {t('updateCheck:check_button')}
        </Button>
      }
    >
      <div className={styles.rows}>
        {rows.map((row) => (
          <div
            key={row.id}
            className={`${styles.row} ${row.status === 'update' ? styles.rowUpdate : ''}`}
          >
            <div className={styles.rowHeader}>
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles[STATUS_BADGE_CLASS[row.status]]}>
                {t(`updateCheck:status_${row.status}`)}
              </span>
            </div>

            <div className={styles.versions}>
              <div className={styles.currentRow}>
                <span className={styles.current}>{row.current || unknownVersionLabel}</span>
                {row.hasLocalChanges && (
                  <span className={styles.localBadge}>{t('updateCheck:local_modified')}</span>
                )}
              </div>
              {row.latest && (
                <div className={styles.latestRow}>
                  <span className={styles.latestLabel}>{t('updateCheck:latest_version')}</span>
                  <span
                    className={`${styles.latest} ${row.status === 'update' ? styles.latestUpdate : ''}`}
                  >
                    {row.latest}
                  </span>
                </div>
              )}
            </div>

            {row.status === 'update' && (
              <span className={styles.caption}>{t('updateCheck:row_update_hint')}</span>
            )}
            {row.status === 'error' && (
              <span className={styles.caption}>{t('updateCheck:row_error_hint')}</span>
            )}
            {row.status === 'unknown' && (
              <span className={styles.caption}>{t('updateCheck:row_unknown_hint')}</span>
            )}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <div className={styles.links}>
          <a
            className={styles.link}
            href={BACKEND_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconGithub size={13} />
            {t('updateCheck:backend_releases')}
            <IconExternalLink size={11} />
          </a>
          <a
            className={styles.link}
            href={panelCompareUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconGithub size={13} />
            {t('updateCheck:panel_diff')}
            <IconExternalLink size={11} />
          </a>
        </div>
        <span className={styles.caption}>{checkedAtLabel}</span>
      </div>

      <p className={styles.hint}>
        {hasUpdate ? t('updateCheck:hint_update') : t('updateCheck:hint')}
      </p>
    </Card>
  );
}
