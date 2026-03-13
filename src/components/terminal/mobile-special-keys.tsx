"use client"

import { Button } from "@/components/ui/button"
import { type MobileSpecialKey } from "@/lib/terminal-protocol"

const KEYS: { key: MobileSpecialKey; label: string }[] = [
  { key: "arrow-up", label: "↑" },
  { key: "arrow-down", label: "↓" },
  { key: "arrow-left", label: "←" },
  { key: "arrow-right", label: "→" },
  { key: "ctrl-c", label: "Ctrl+C" },
  { key: "tab", label: "Tab" },
  { key: "esc", label: "Esc" },
]

type Props = {
  onSendKeyAction: (key: MobileSpecialKey) => void
}

export function MobileSpecialKeys({ onSendKeyAction }: Props) {
  return (
    <div data-testid="mobile-special-keys" className="grid grid-cols-4 gap-2 sm:grid-cols-7 sm:gap-2.5">
      {KEYS.map((item) => (
        <Button
          data-testid={`special-key-${item.key}`}
          aria-label={`special-${item.key}`}
          key={item.key}
          type="button"
          variant="outline"
          className="h-11 min-h-[44px] min-w-0 px-1.5 text-xs sm:text-sm"
          onClick={() => onSendKeyAction(item.key)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  )
}
