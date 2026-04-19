import { describe, it, expect } from 'vitest';
import { t, registerTranslations, setLocale, getLocale } from '../i18n';

describe('i18n stub', () => {
  it('returns the registered translation', () => {
    expect(t('common.refresh')).toBe('Refresh');
  });

  it('falls back to the key for missing entries', () => {
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('interpolates template variables', () => {
    registerTranslations('en-IN', { 'test.greeting': 'Hello {name}, you have {count} orders.' });
    expect(t('test.greeting', { name: 'Pat', count: 3 })).toBe('Hello Pat, you have 3 orders.');
  });

  it('keeps placeholders for missing variables', () => {
    expect(t('test.greeting', { name: 'Pat' })).toBe('Hello Pat, you have {count} orders.');
  });

  it('only switches to a registered locale', () => {
    setLocale('fr-FR');
    expect(getLocale()).toBe('en-IN');
    registerTranslations('fr-FR', { 'common.refresh': 'Actualiser' });
    setLocale('fr-FR');
    expect(getLocale()).toBe('fr-FR');
    expect(t('common.refresh')).toBe('Actualiser');
    setLocale('en-IN');
  });
});
