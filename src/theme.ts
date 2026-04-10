import type { ThemeName } from "./types";

export type AppTheme = {
  name: ThemeName;
  background: string;
  panel: string;
  panelAlt: string;
  selection: string;
  selectionCell: string;
  selectionText: string;
  border: string;
  borderActive: string;
  text: string;
  muted: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  statusBarBg: string;
  statusBarText: string;
};

export const themes: Record<ThemeName, AppTheme> = {
  monokai: {
    name: "monokai",
    background: "#171717",
    panel: "#202020",
    panelAlt: "#262626",
    selection: "#6f5f96",
    selectionCell: "#3a3254",
    selectionText: "#f8f8f2",
    border: "#4a4a4a",
    borderActive: "#a6e22e",
    text: "#f8f8f2",
    muted: "#8f908a",
    accent: "#66d9ef",
    success: "#a6e22e",
    warning: "#fd971f",
    error: "#f92672",
    statusBarBg: "#111111",
    statusBarText: "#f8f8f2",
  },
};
