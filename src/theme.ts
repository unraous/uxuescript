import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readonly, shallowRef } from "vue";

export type ThemeMode = "light" | "dark";

export const themes = {
  gentian: {
    brand: "#0d58a4",
    surface: "#e8dcc4",
    surfaceLight: "#f0ebe0",
    mode: "light",
  },
  delphinium: {
    brand: "#31566d",
    surface: "#e8cfb3",
    surfaceLight: "#f4e5d3",
    mode: "light",
  },
  camellia: {
    brand: "#9c3b45",
    surface: "#d2ddea",
    surfaceLight: "#e8edf3",
    mode: "light",
  },
  gardenia: {
    brand: "#3e6552",
    surface: "#ead6df",
    surfaceLight: "#f6eaf0",
    mode: "light",
  },
  marigold: {
    brand: "#89611e",
    surface: "#f0d8a4",
    surfaceLight: "#fff2d0",
    mode: "light",
  },
  cornflower: {
    brand: "#315f83",
    surface: "#c8e1f0",
    surfaceLight: "#edf7fc",
    mode: "light",
  },
  charcoal: {
    brand: "#d4d6db",
    surface: "#252628",
    surfaceLight: "#3c3e41",
    mode: "dark",
  },
  iris: {
    brand: "#c2b2ff",
    surface: "#211d35",
    surfaceLight: "#332b4d",
    mode: "dark",
  },
  dahlia: {
    brand: "#f0c879",
    surface: "#222a24",
    surfaceLight: "#343d32",
    mode: "dark",
  },
  poppy: {
    brand: "#a4e6c1",
    surface: "#172a25",
    surfaceLight: "#244039",
    mode: "dark",
  },
  peony: {
    brand: "#93475f",
    surface: "#f2e7e1",
    surfaceLight: "#fcf6ef",
    mode: "light",
  },
  wisteria: {
    brand: "#665187",
    surface: "#e7e5f0",
    surfaceLight: "#f6f3fa",
    mode: "light",
  },
  lotus: {
    brand: "#edb5c4",
    surface: "#2a1e2b",
    surfaceLight: "#402b3b",
    mode: "dark",
  },
  hydrangea: {
    brand: "#a5cfee",
    surface: "#182838",
    surfaceLight: "#283c50",
    mode: "dark",
  },
} as const;

export type ThemeName = keyof typeof themes;
export const defaultTheme: ThemeName = "gentian";
export const themeNames = (Object.keys(themes) as ThemeName[]).sort(
  (left, right) => Number(themes[left].mode === "dark") - Number(themes[right].mode === "dark"),
);

export interface ThemeColors {
  brand: string;
  surface: string;
  surfaceLight: string;
}

const colorProperties: Record<keyof ThemeColors, string> = {
  brand: "--theme-brand",
  surface: "--theme-surface",
  surfaceLight: "--theme-surface-light",
};

const overrides = shallowRef<Partial<ThemeColors>>({});
export const themeOverrides = readonly(overrides);
const selectedTheme = shallowRef<ThemeName>(defaultTheme);
export const activeTheme = readonly(selectedTheme);

function resolveTheme(name: string): ThemeName {
  return name in themes ? (name as ThemeName) : defaultTheme;
}

function colorsForTheme(name: string): ThemeColors {
  const { brand, surface, surfaceLight } = themes[resolveTheme(name)];
  return { brand, surface, surfaceLight };
}

function applyThemeMode(mode: ThemeMode) {
  document.documentElement.dataset.themeMode = mode;
}

export async function withThemeTransitionsDisabled<T>(
  action: () => T | Promise<T>,
): Promise<T> {
  const rootStyle = document.documentElement.style;
  const previousTransition = rootStyle.getPropertyValue("transition");
  const previousPriority = rootStyle.getPropertyPriority("transition");
  rootStyle.setProperty("transition", "none");

  try {
    return await action();
  } finally {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (previousTransition) {
      rootStyle.setProperty(
        "transition",
        previousTransition,
        previousPriority,
      );
    } else {
      rootStyle.removeProperty("transition");
    }
  }
}

type ThemeColorUpdate = Partial<ThemeColors> & { mode?: ThemeMode };

function applyOverrides(next: Partial<ThemeColors>) {
  for (const key of Object.keys(colorProperties) as (keyof ThemeColors)[]) {
    const value = next[key];
    if (value === overrides.value[key]) continue;
    if (value === undefined) {
      document.documentElement.style.removeProperty(colorProperties[key]);
    } else {
      document.documentElement.style.setProperty(colorProperties[key], value);
    }
  }
  overrides.value = { ...next };
}

async function syncMask() {
  const update: ThemeColorUpdate = {
    ...overrides.value,
    mode: themes[selectedTheme.value].mode,
  };
  await Promise.all([
    emitTo("mask", "theme-colors-changed", update),
    emitTo("chaoxing-mask", "theme-colors-changed", update),
  ]);
}

/** Apply partial color overrides immediately; unspecified colors keep their current values. */
export async function setThemeColors(
  colors: Partial<ThemeColors>,
): Promise<void> {
  applyOverrides({ ...overrides.value, ...colors });
  await syncMask();
}

/** Remove runtime overrides and return to the colors declared in theme.css. */
export async function resetThemeColors(): Promise<void> {
  applyOverrides({});
  await syncMask();
}

/** Apply a named theme in the current WebView and broadcast its colors to the masks. */
export async function setTheme(name: string): Promise<void> {
  const resolved = resolveTheme(name);
  selectedTheme.value = resolved;
  applyThemeMode(themes[resolved].mode);
  applyOverrides(resolved === defaultTheme ? {} : colorsForTheme(resolved));
  await syncMask();
}

/** Initialize a WebView's palette without broadcasting to other WebViews. */
export function initializeTheme(name: string): void {
  const resolved = resolveTheme(name);
  selectedTheme.value = resolved;
  applyThemeMode(themes[resolved].mode);
  applyOverrides(resolved === defaultTheme ? {} : colorsForTheme(resolved));
}

/** Keep the separate mask Webview in sync with changes made in the main Webview. */
export function listenForThemeColors(): Promise<UnlistenFn> {
  return listen<ThemeColorUpdate>("theme-colors-changed", (event) => {
    const { mode, ...colors } = event.payload;
    applyOverrides(colors);
    if (mode) applyThemeMode(mode);
  });
}
