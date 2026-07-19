export type ThemeChoice = "theme-1" | "theme-2";

export const themeStorageKey = "crystal-shop-theme";

export const themeOptions: Array<{
  value: ThemeChoice;
  label: string;
  description: string;
}> = [
  {
    value: "theme-1",
    label: "Theme 1",
    description: "Classic blue",
  },
  {
    value: "theme-2",
    label: "Theme 2",
    description: "Green client trial",
  },
];

export function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "theme-1" || value === "theme-2";
}

export function getStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "theme-1";
  const storedTheme = window.localStorage.getItem(themeStorageKey);
  return isThemeChoice(storedTheme) ? storedTheme : "theme-1";
}

export function persistTheme(theme: ThemeChoice) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(themeStorageKey, theme);
}
