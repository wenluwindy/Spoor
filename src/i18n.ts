import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './i18n/en';
import { zh } from './i18n/zh';

const resources = {
  en: { translation: en },
  zh: { translation: zh },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem('app_language') || 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
