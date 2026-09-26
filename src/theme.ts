import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { readonly, shallowRef } from "vue";

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
  if (isTauri()) {
    await emitTo("mask", "theme-colors-changed", overrides.value);
  }
}

/** Apply partial color overrides immediately; unspecified colors keep their current values. */
export async function setThemeColors(colors: Partial<ThemeColors>): Promise<void> {
  applyOverrides({ ...overrides.value, ...colors });
  await syncMask();
}

/** Remove runtime overrides and return to the colors declared in theme.css. */
export async function resetThemeColors(): Promise<void> {
  applyOverrides({});
  await syncMask();
}

/** Keep the separate mask Webview in sync with changes made in the main Webview. */
export function listenForThemeColors(): Promise<UnlistenFn> {
  return listen<Partial<ThemeColors>>("theme-colors-changed", (event) => {
    applyOverrides(event.payload);
  });
}
