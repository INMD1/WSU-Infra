'use client';

import * as React from 'react';
import { Theme } from '@/lib/themes';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  const isDark = theme === 'dark';

  return (
    <div className="flex items-center rounded-lg border bg-card p-1">
      <Button
        variant={isDark ? 'ghost' : 'default'}
        size="sm"
        onClick={() => setTheme('light')}
        className="flex items-center gap-2 px-3 py-1.5 text-xs"
      >
        <Sun className="h-3.5 w-3.5" />
        <span>Light</span>
      </Button>
      <Button
        variant={!isDark ? 'ghost' : 'default'}
        size="sm"
        onClick={() => setTheme('dark')}
        className="flex items-center gap-2 px-3 py-1.5 text-xs"
      >
        <Moon className="h-3.5 w-3.5" />
        <span>Dark</span>
      </Button>
    </div>
  );
}
