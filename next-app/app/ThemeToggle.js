"use client";

import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "meenakshi-ui-theme";

function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "night" ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState("day");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme =
      storedTheme === "night" || storedTheme === "day"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "night"
          : "day";

    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const isNightMode = theme === "night";

  return (
    <button
      className="themeToggle"
      type="button"
      onClick={() => setTheme(isNightMode ? "day" : "night")}
      aria-label={`Switch to ${isNightMode ? "day" : "night"} mode`}
    >
      <span className="themeToggleLabel">{isNightMode ? "Night" : "Day"} Mode</span>
      <span className={`themeToggleTrack ${isNightMode ? "themeToggleTrackNight" : ""}`}>
        <span className="themeToggleThumb" />
      </span>
    </button>
  );
}
