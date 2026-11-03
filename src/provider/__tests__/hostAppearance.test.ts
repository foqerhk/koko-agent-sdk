import {
  invertTheme,
  resolveChromeColors,
  resolveThemeColors,
} from '../HostAppearanceStore';

describe('chrome theme inverts the host App theme', () => {
  it('goes light over a dark App', () => {
    expect(invertTheme('dark')).toBe('light');
    expect(resolveChromeColors('dark').mode).toBe('light');
  });

  it('goes dark over a light App', () => {
    expect(invertTheme('light')).toBe('dark');
    expect(resolveChromeColors('light').mode).toBe('dark');
  });

  it('assumes a light App when the host reports nothing', () => {
    // Keeps chrome dark, which is what the SDK has always shipped.
    expect(invertTheme(undefined)).toBe('dark');
    expect(invertTheme(null)).toBe('dark');
  });

  it('keeps the progress pill readable against the App behind it', () => {
    const overDark = resolveChromeColors('dark');
    const overLight = resolveChromeColors('light');
    expect(overDark.progressBg).not.toBe(overLight.progressBg);
    expect(overDark.progressText).not.toBe(overLight.progressText);
    // Light chrome needs dark text and vice versa.
    expect(overDark.progressText).toBe(resolveThemeColors('light').progressText);
    expect(overLight.progressText).toBe(resolveThemeColors('dark').progressText);
  });

  it('flips the status bar with the chrome, not with the App', () => {
    expect(resolveChromeColors('dark').statusBar).toBe('dark-content');
    expect(resolveChromeColors('light').statusBar).toBe('light-content');
  });

  it('still maps a theme name straight to its own palette', () => {
    // resolveThemeColors stays literal — only chrome resolution inverts.
    expect(resolveThemeColors('dark').mode).toBe('dark');
    expect(resolveThemeColors('light').mode).toBe('light');
  });
});
