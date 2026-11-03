import { resolveBranding } from '../branding';

describe('resolveBranding', () => {
  it('uses defaults without custom branding', () => {
    const r = resolveBranding('zh', undefined, {
      custom_branding: false,
      locale: true,
    });
    expect(r.name).toBe('Koko');
    expect(r.downgraded).toBe(false);
  });

  it('downgrades custom branding without entitlement', () => {
    const r = resolveBranding(
      'zh',
      { name: 'Acme', tagline: 'Hi', placeholder: 'Ask…' },
      { custom_branding: false, locale: true },
    );
    expect(r.name).toBe('Koko');
    expect(r.downgraded).toBe(true);
  });

  it('applies custom branding with entitlement', () => {
    const r = resolveBranding(
      'en',
      { name: 'Acme', tagline: 'Hi', placeholder: 'Ask…', primaryColor: '#111' },
      { custom_branding: true, locale: true },
    );
    expect(r.name).toBe('Acme');
    expect(r.tagline).toBe('Hi');
    expect(r.placeholder).toBe('Ask…');
    expect(r.primaryColor).toBe('#111');
    expect(r.downgraded).toBe(false);
  });
});
