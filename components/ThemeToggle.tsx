'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system']
    const currentIndex = themes.indexOf(theme || 'system')
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  const icon = theme === 'light' ? <Sun className="h-5 w-5" /> 
    : theme === 'dark' ? <Moon className="h-5 w-5" /> 
    : <Monitor className="h-5 w-5" />

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      title={`当前主题: ${theme}`}
    >
      {icon}
    </Button>
  )
}