'use client';

import * as React from 'react';
import { Theme, themes, themeInfo, type ColorTokens } from '@/lib/themes';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themeColors: ColorTokens;
  themeInfo: typeof themeInfo[Theme];
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('light');
  const [mounted, setMounted] = React.useState(false);

  // 초기 테마 로드 (localStorage + 시스템 선호도)
  React.useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored) {
      setThemeState(stored);
    } else {
      // 시스템 다크 모드 선호도 체크
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setThemeState(prefersDark ? 'dark' : 'light');
    }
    setMounted(true);
  }, []);

  // 테마 변경 시 localStorage 저장 및 CSS 변수 업데이트
  const setTheme = React.useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);

    // CSS 변수 업데이트
    const root = document.documentElement;
    const colors = themes[newTheme];

    // 모든 컬러 토큰을 CSS 변수로 설정
    if (colors) {
      Object.entries(colors as unknown as Record<string, string>).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value);
      });
    }

    // 다크 모드 클래스 관리
    if (newTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, []);

  // 마운트 시 초기 테마 적용
  React.useEffect(() => {
    if (mounted) {
      setTheme(theme);
    }
  }, [theme, mounted, setTheme]);

  const value = React.useMemo(
    () => ({
      theme,
      setTheme,
      themeColors: themes[theme],
      themeInfo: themeInfo[theme],
    }),
    [theme, setTheme]
  );

  // 하이드레이션 불일치 방지
  if (!mounted) {
    return null;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
