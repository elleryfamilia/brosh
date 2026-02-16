/**
 * Settings Context Provider
 *
 * React context for managing application settings and theme.
 * Handles persistence via electron IPC and provides live updates.
 */

import {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  AppSettings,
  SettingsUpdate,
  SettingsContextType,
  Theme,
} from './types';
import { defaultSettings } from './defaults';
import { getTheme } from './themes';

/**
 * Settings context with default values
 */
export const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  theme: getTheme(defaultSettings.appearance.theme),
  updateSettings: () => {},
  resetSettings: () => {},
  isLoaded: false,
});

/**
 * Parse a hex color to RGB values (0-255)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Calculate relative luminance of a color (WCAG formula)
 * Returns a value between 0 (black) and 1 (white)
 */
function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);

  // Convert to sRGB (0-1 range)
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;

  // Apply gamma correction (linearize)
  const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  // Calculate luminance using WCAG coefficients
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Determine if a color is "light" (needs dark text) or "dark" (needs light text)
 * Uses WCAG relative luminance threshold
 */
function isLightColor(hex: string): boolean {
  return getRelativeLuminance(hex) > 0.179;
}

/**
 * Apply theme CSS variables to the document
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const { colors } = theme;

  // Base colors
  root.style.setProperty('--bg-primary', colors.background);
  root.style.setProperty('--fg-primary', colors.foreground);

  // Use theme's explicit foreground if provided, otherwise auto-calculate
  const accentForeground = colors.accentForeground
    ?? (isLightColor(colors.accent) ? '#1a1a1a' : '#ffffff');
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-hover', colors.accentHover);
  root.style.setProperty('--accent-foreground', accentForeground);

  // Status
  root.style.setProperty('--status-success', colors.success);
  root.style.setProperty('--status-warning', colors.warning);
  root.style.setProperty('--status-error', colors.error);

  // Surfaces
  root.style.setProperty('--surface-0', colors.surface0);
  root.style.setProperty('--surface-1', colors.surface1);
  root.style.setProperty('--surface-2', colors.surface2);

  // Borders
  root.style.setProperty('--border', colors.border);

  // Terminal ANSI colors
  root.style.setProperty('--ansi-black', colors.ansi.black);
  root.style.setProperty('--ansi-red', colors.ansi.red);
  root.style.setProperty('--ansi-green', colors.ansi.green);
  root.style.setProperty('--ansi-yellow', colors.ansi.yellow);
  root.style.setProperty('--ansi-blue', colors.ansi.blue);
  root.style.setProperty('--ansi-magenta', colors.ansi.magenta);
  root.style.setProperty('--ansi-cyan', colors.ansi.cyan);
  root.style.setProperty('--ansi-white', colors.ansi.white);
  root.style.setProperty('--ansi-bright-black', colors.ansi.brightBlack);
  root.style.setProperty('--ansi-bright-red', colors.ansi.brightRed);
  root.style.setProperty('--ansi-bright-green', colors.ansi.brightGreen);
  root.style.setProperty('--ansi-bright-yellow', colors.ansi.brightYellow);
  root.style.setProperty('--ansi-bright-blue', colors.ansi.brightBlue);
  root.style.setProperty('--ansi-bright-magenta', colors.ansi.brightMagenta);
  root.style.setProperty('--ansi-bright-cyan', colors.ansi.brightCyan);
  root.style.setProperty('--ansi-bright-white', colors.ansi.brightWhite);

  // Set theme data attribute for CSS selectors
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-theme-mode', theme.isDark ? 'dark' : 'light');
}

interface SettingsProviderProps {
  children: ReactNode;
}

/**
 * Settings Provider Component
 */
export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  // Get the current theme based on settings
  const theme = useMemo(
    () => getTheme(settings.appearance.theme),
    [settings.appearance.theme]
  );

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Apply window opacity via Electron (actual window transparency)
  useEffect(() => {
    const opacity = settings.advanced.windowOpacity / 100;
    window.terminalAPI.setWindowOpacity(opacity).catch(console.error);
  }, [settings.advanced.windowOpacity]);

  // Load settings on mount
  useEffect(() => {
    window.terminalAPI
      .getSettings()
      .then((loadedSettings) => {
        setSettings(loadedSettings);
        setIsLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
        setIsLoaded(true); // Still mark as loaded, using defaults
      });
  }, []);

  // Update settings
  const updateSettings = useCallback((updates: SettingsUpdate) => {
    window.terminalAPI
      .updateSettings(updates)
      .then((updatedSettings) => {
        setSettings(updatedSettings);
      })
      .catch((err) => {
        console.error('Failed to update settings:', err);
      });
  }, []);

  // Reset settings
  const resetSettings = useCallback(() => {
    window.terminalAPI
      .resetSettings()
      .then((defaultSettings) => {
        setSettings(defaultSettings);
      })
      .catch((err) => {
        console.error('Failed to reset settings:', err);
      });
  }, []);

  const contextValue = useMemo<SettingsContextType>(
    () => ({
      settings,
      theme,
      updateSettings,
      resetSettings,
      isLoaded,
    }),
    [settings, theme, updateSettings, resetSettings, isLoaded]
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
}
