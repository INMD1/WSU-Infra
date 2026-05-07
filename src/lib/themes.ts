// 테마 타입 정의
export type Theme = 'light' | 'dark';

// 컬러 토큰 인터페이스
export interface ColorTokens {
  // Brand & Accent
  primary: string;
  'primary-active': string;
  'primary-disabled': string;
  'accent-teal': string;
  'accent-amber': string;
  // Surface
  canvas: string;
  'surface-soft': string;
  'surface-card': string;
  'surface-cream-strong': string;
  'surface-dark': string;
  'surface-dark-elevated': string;
  'surface-dark-soft': string;
  hairline: string;
  'hairline-soft': string;
  // Text
  ink: string;
  'body-strong': string;
  body: string;
  muted: string;
  'muted-soft': string;
  'on-primary': string;
  'on-dark': string;
  'on-dark-soft': string;
  // Semantic
  success: string;
  warning: string;
  error: string;
  // Shadcn-compatible tokens
  background: string;
  foreground: string;
  card: string;
  'card-foreground': string;
  popover: string;
  'popover-foreground': string;
  secondary: string;
  'secondary-foreground': string;
  'muted-foreground': string;
  accent: string;
  'accent-foreground': string;
  destructive: string;
  'destructive-foreground': string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  'sidebar-foreground': string;
  'sidebar-primary': string;
  'sidebar-primary-foreground': string;
  'sidebar-accent': string;
  'sidebar-accent-foreground': string;
  'sidebar-border': string;
  'sidebar-ring': string;
}

// 폰트 토큰 인터페이스
export interface FontTokens {
  display: string[];
  sans: string[];
  mono: string[];
}

// 테마 정의

// Claude.com 테마 (DESIGN.md 기반)
export const claudTheme: ColorTokens = {
  // Brand & Accent
  primary: '#cc785c',
  'primary-active': '#a9583e',
  'primary-disabled': '#e6dfd8',
  'accent-teal': '#5db8a6',
  'accent-amber': '#e8a55a',
  // Surface
  canvas: '#faf9f5',
  'surface-soft': '#f5f0e8',
  'surface-card': '#efe9de',
  'surface-cream-strong': '#e8e0d2',
  'surface-dark': '#181715',
  'surface-dark-elevated': '#252320',
  'surface-dark-soft': '#1f1e1b',
  hairline: '#e6dfd8',
  'hairline-soft': '#ebe6df',
  // Text
  ink: '#141413',
  'body-strong': '#252523',
  body: '#3d3d3a',
  muted: '#6c6a64',
  'muted-soft': '#8e8b82',
  'on-primary': '#ffffff',
  'on-dark': '#faf9f5',
  'on-dark-soft': '#a09d96',
  // Semantic
  success: '#5db872',
  warning: '#d4a017',
  error: '#c64545',
  // Shadcn tokens (light mode)
  background: '#faf9f5',
  foreground: '#141413',
  card: '#efe9de',
  'card-foreground': '#141413',
  popover: '#faf9f5',
  'popover-foreground': '#141413',
  secondary: '#f5f0e8',
  'secondary-foreground': '#252523',
  'muted-foreground': '#6c6a64',
  accent: '#f5f0e8',
  'accent-foreground': '#252523',
  destructive: '#c64545',
  'destructive-foreground': '#ffffff',
  border: '#e6dfd8',
  input: '#e6dfd8',
  ring: '#cc785c',
  sidebar: '#faf9f5',
  'sidebar-foreground': '#141413',
  'sidebar-primary': '#141413',
  'sidebar-primary-foreground': '#faf9f5',
  'sidebar-accent': '#efe9de',
  'sidebar-accent-foreground': '#141413',
  'sidebar-border': '#e6dfd8',
  'sidebar-ring': '#cc785c',
};

// GCP (Google Cloud Platform) 테마
export const gcpTheme: ColorTokens = {
  // Brand & Accent (GCP Blue)
  primary: '#1a73e8',
  'primary-active': '#1557b0',
  'primary-disabled': '#c2e7ff',
  'accent-teal': '#00897b',
  'accent-amber': '#f9ab00',
  // Surface
  canvas: '#f8f9fa',
  'surface-soft': '#f1f3f4',
  'surface-card': '#ffffff',
  'surface-cream-strong': '#e8eaed',
  'surface-dark': '#202124',
  'surface-dark-elevated': '#3c4043',
  'surface-dark-soft': '#292b2f',
  hairline: '#dadce0',
  'hairline-soft': '#e8eaed',
  // Text
  ink: '#202124',
  'body-strong': '#202124',
  body: '#202124',
  muted: '#5f6368',
  'muted-soft': '#80868b',
  'on-primary': '#ffffff',
  'on-dark': '#f8f9fa',
  'on-dark-soft': '#9aa0a6',
  // Semantic
  success: '#137333',
  warning: '#f9ab00',
  error: '#d93025',
  // Shadcn tokens (light mode)
  background: '#f8f9fa',
  foreground: '#202124',
  card: '#ffffff',
  'card-foreground': '#202124',
  popover: '#ffffff',
  'popover-foreground': '#202124',
  secondary: '#f8f9fa',
  'secondary-foreground': '#202124',
  'muted-foreground': '#5f6368',
  accent: '#f1f3f4',
  'accent-foreground': '#202124',
  destructive: '#d93025',
  'destructive-foreground': '#ffffff',
  border: '#dadce0',
  input: '#dadce0',
  ring: '#1a73e8',
  sidebar: '#ffffff',
  'sidebar-foreground': '#202124',
  'sidebar-primary': '#1a73e8',
  'sidebar-primary-foreground': '#ffffff',
  'sidebar-accent': '#f8f9fa',
  'sidebar-accent-foreground': '#202124',
  'sidebar-border': '#dadce0',
  'sidebar-ring': '#1a73e8',
};

// Dark 테마 (시스템 다크 모드)
export const darkTheme: ColorTokens = {
  // Brand & Accent (保持一致的 coral)
  primary: '#cc785c',
  'primary-active': '#a9583e',
  'primary-disabled': '#3d3633',
  'accent-teal': '#5db8a6',
  'accent-amber': '#e8a55a',
  // Surface
  canvas: '#181715',
  'surface-soft': '#1f1e1b',
  'surface-card': '#252320',
  'surface-cream-strong': '#3d3633',
  'surface-dark': '#0d0d0c',
  'surface-dark-elevated': '#1f1e1b',
  'surface-dark-soft': '#252320',
  hairline: '#3d3633',
  'hairline-soft': '#2d2a27',
  // Text
  ink: '#faf9f5',
  'body-strong': '#faf9f5',
  body: '#a09d96',
  muted: '#8e8b82',
  'muted-soft': '#6c6a64',
  'on-primary': '#ffffff',
  'on-dark': '#faf9f5',
  'on-dark-soft': '#a09d96',
  // Semantic
  success: '#5db872',
  warning: '#d4a017',
  error: '#c64545',
  // Shadcn tokens (dark mode)
  background: '#181715',
  foreground: '#faf9f5',
  card: '#252320',
  'card-foreground': '#faf9f5',
  popover: '#252320',
  'popover-foreground': '#faf9f5',
  secondary: '#1f1e1b',
  'secondary-foreground': '#faf9f5',
  'muted-foreground': '#8e8b82',
  accent: '#1f1e1b',
  'accent-foreground': '#faf9f5',
  destructive: '#c64545',
  'destructive-foreground': '#ffffff',
  border: '#3d3633',
  input: '#3d3633',
  ring: '#cc785c',
  sidebar: '#252320',
  'sidebar-foreground': '#faf9f5',
  'sidebar-primary': '#faf9f5',
  'sidebar-primary-foreground': '#181715',
  'sidebar-accent': '#1f1e1b',
  'sidebar-accent-foreground': '#faf9f5',
  'sidebar-border': '#3d3633',
  'sidebar-ring': '#cc785c',
};

// 테마 목록
export const themes: Record<Theme, ColorTokens> = {
  light: claudTheme,
  dark: darkTheme,
};

// 테마 정보 (UI 표시용)
export const themeInfo: Record<Theme, { label: string; icon: 'sun' | 'moon' }> = {
  light: {
    label: 'Light',
    icon: 'sun',
  },
  dark: {
    label: 'Dark',
    icon: 'moon',
  },
};

// 테마 색상 미리보기 (UI 용)
export const themePreview: Record<Theme, { bg: string; border: string; accent: string }> = {
  light: {
    bg: '#faf9f5',
    border: '#e6dfd8',
    accent: '#cc785c',
  },
  dark: {
    bg: '#181715',
    border: '#3d3633',
    accent: '#cc785c',
  },
};

// 폰트 설정
export const fontTokens: FontTokens = {
  display: ['Cormorant Garamond', 'Tiempos Headline', 'Georgia', 'serif'],
  sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
  mono: ['JetBrains Mono', 'monospace'],
};
