/**
 * Lightweight i18n stub for the admin panel.
 *
 * Phase 5 / §4.2 of ADMIN_UI_OPTIMIZATION_PLAN.md asks us to wrap user-visible
 * strings in a `t()` helper so a future locale swap can be done in one place.
 *
 * Today we only ship `en-IN`. Strings that have not been added to the
 * dictionary fall back to the key itself, so callers can be incrementally
 * migrated without breaking output.
 *
 * Usage:
 *   import { t } from '../utils/i18n';
 *   <button>{t('common.refresh')}</button>
 *
 * Interpolation:
 *   t('orders.bulkConfirm', { count: 12 })
 *   → "You're about to update 12 orders."
 */

const DEFAULT_LOCALE = 'en-IN';

const dictionaries = {
  'en-IN': {
    'common.refresh': 'Refresh',
    'common.retry': 'Retry',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.close': 'Close',
    'common.loading': 'Loading…',
    'common.copy': 'Copy',
    'common.export': 'Export CSV',
    'common.search': 'Search…',
    'common.empty': 'Nothing to show yet.',
    'common.error': 'Something went wrong',
  },
};

let activeLocale = DEFAULT_LOCALE;

export const setLocale = (locale) => {
  if (dictionaries[locale]) {
    activeLocale = locale;
  }
};

export const getLocale = () => activeLocale;

const interpolate = (template, vars) => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`,
  );
};

export const t = (key, vars) => {
  const dict = dictionaries[activeLocale] || dictionaries[DEFAULT_LOCALE];
  const template = dict[key] ?? key;
  return interpolate(template, vars);
};

/**
 * Register additional translations at runtime. Useful for tests or for adding
 * locale bundles lazily without touching this file.
 */
export const registerTranslations = (locale, entries) => {
  dictionaries[locale] = { ...(dictionaries[locale] || {}), ...entries };
};

export default t;
