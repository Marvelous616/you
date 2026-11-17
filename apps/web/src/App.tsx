import React, { useCallback, useEffect, useState } from 'react';
import { DayView } from './pages/DayView.js';
import { Settings } from './pages/Settings.js';
import './index.css';

type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'life-logger-theme';

function readInitialTheme(): Theme {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const App: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const handleSettingsOpen = useCallback(() => setSettingsOpen(true), []);

  return (
    <React.StrictMode>
      <DayView
        theme={theme}
        onSettingsOpen={handleSettingsOpen}
        onThemeChange={setTheme}
      />
      {settingsOpen && (
        <Settings theme={theme} onThemeChange={setTheme} onClose={() => setSettingsOpen(false)} />
      )}
    </React.StrictMode>
  );
};
