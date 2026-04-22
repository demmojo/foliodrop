"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import clsx from "clsx"

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="w-14 h-8 rounded-full bg-border animate-pulse" />
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={clsx(
        "relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        isDark ? "bg-border" : "bg-border"
      )}
      aria-label="Toggle dark mode"
    >
      <span className="sr-only">Enable {isDark ? 'light' : 'dark'} mode</span>
      <span
        className={clsx(
          "flex h-6 w-6 transform rounded-full bg-surface shadow-sm transition-transform duration-300 ease-in-out items-center justify-center",
          isDark ? "translate-x-7" : "translate-x-1"
        )}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-muted" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-muted" />
        )}
      </span>
    </button>
  )
}