/**
 * i18next 国际化配置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
// fork 自研：更新检查独立命名空间，避免改动上游大体积 locale 文件造成合并冲突
import zhCNUpdateCheck from './locales/updateCheck/zh-CN.json';
import zhTWUpdateCheck from './locales/updateCheck/zh-TW.json';
import enUpdateCheck from './locales/updateCheck/en.json';
import ruUpdateCheck from './locales/updateCheck/ru.json';
import { getInitialLanguage } from '@/utils/language';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN, updateCheck: zhCNUpdateCheck },
    'zh-TW': { translation: zhTW, updateCheck: zhTWUpdateCheck },
    en: { translation: en, updateCheck: enUpdateCheck },
    ru: { translation: ru, updateCheck: ruUpdateCheck },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false, // React 已经转义
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
