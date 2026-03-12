"use client"

import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react"

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import { Button } from "@/components/ui/button"

type ClientServerMessage = { type: "terminal.output"; data: string } | { type: "terminal.closed" }

type SessionsResponse = {
  terminalIds: string[]
  defaultTerminalId?: string
}

type CreateSessionResponse = {
  terminalId: string
}

const DEBUG_MODE = process.env.NEXT_PUBLIC_TERMINAL_DEBUG === "1"
const SPECIAL_INPUT_PRESETS = [
  "ESC",
  "TAB",
  "SHIFT+TAB",
  "ENTER",
  "CTRL+C",  
  "ARROW-UP",
  "ARROW-DOWN",
  "ARROW-LEFT",
  "ARROW-RIGHT",
  "BACKSPACE",
  "CTRL+B",  
  "SHIFT",
  "CTRL",
  "ALT",
] as const
const SWIPE_THRESHOLD_PX = 40

function logDebug(message: string, meta?: Record<string, unknown>) {
  if (!DEBUG_MODE) {
    return
  }

  const suffix = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[terminal-viewer][debug] ${message}${suffix}`)
}

function pickNextActive(
  ids: string[],
  previousActive: string | null,
  preferredActive?: string | null,
  defaultTerminalId?: string
) {
  if (preferredActive && ids.includes(preferredActive)) {
    return preferredActive
  }

  if (previousActive && ids.includes(previousActive)) {
    return previousActive
  }

  if (defaultTerminalId && ids.includes(defaultTerminalId)) {
    return defaultTerminalId
  }

  return ids[0] ?? null
}

export function TerminalViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const specialPresetRef = useRef<HTMLInputElement | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [specialExpression, setSpecialExpression] = useState("")
  const [isSpecialDropdownOpen, setIsSpecialDropdownOpen] = useState(false)
  const [terminalIds, setTerminalIds] = useState<string[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [isSessionReady, setIsSessionReady] = useState(false)

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null)

  const postJson = useCallback(async (url: string, payload: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      logDebug("post failed", { url, status: response.status })
    }
  }, [])

  const fetchSessions = useCallback(async (preferredActive?: string | null) => {
    const response = await fetch("/api/terminal/sessions", { cache: "no-store" })
    if (!response.ok) {
      logDebug("sessions fetch failed", { status: response.status })
      setIsSessionReady(true)
      return
    }

    const payload = (await response.json()) as SessionsResponse
    setTerminalIds(payload.terminalIds)
    setActiveTerminalId((previousActive) =>
      pickNextActive(payload.terminalIds, previousActive, preferredActive, payload.defaultTerminalId)
    )
    setIsSessionReady(true)
  }, [])

  const sendInput = useCallback(
    async (data: string) => {
      await postJson("/api/terminal/input/text", { data, terminalId: activeTerminalId ?? undefined })
    },
    [activeTerminalId, postJson]
  )

  const sendSequence = useCallback(
    async (expression: string) => {
      await postJson("/api/terminal/input/sequence", { expression, terminalId: activeTerminalId ?? undefined })
    },
    [activeTerminalId, postJson]
  )

  const sendResize = useCallback(
    async (cols: number, rows: number) => {
      await postJson("/api/terminal/resize", { cols, rows, terminalId: activeTerminalId ?? undefined })
    },
    [activeTerminalId, postJson]
  )

  const switchTerminalByOffset = useCallback(
    (offset: number) => {
      if (terminalIds.length < 2 || !activeTerminalId) {
        return
      }

      const currentIndex = terminalIds.indexOf(activeTerminalId)
      if (currentIndex < 0) {
        return
      }

      const nextIndex = (currentIndex + offset + terminalIds.length) % terminalIds.length
      setActiveTerminalId(terminalIds[nextIndex])
    },
    [activeTerminalId, terminalIds]
  )

  const createTerminal = useCallback(async () => {
    const response = await fetch("/api/terminal/create", { method: "POST" })
    if (!response.ok) {
      logDebug("create session failed", { status: response.status })
      return
    }

    const payload = (await response.json()) as CreateSessionResponse

    setTerminalIds((previous) => {
      if (previous.includes(payload.terminalId)) {
        return previous
      }
      return [...previous, payload.terminalId]
    })
    setActiveTerminalId(payload.terminalId)
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchSessions()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [fetchSessions])

  useEffect(() => {
    if (!containerRef.current || !activeTerminalId || !isSessionReady) {
      return
    }

    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 200000,
      convertEol: true,
      fontSize: 14,
      theme: {
        background: "#000000",
      },
    })

    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    fitAddon.fit()

    const eventSource = new EventSource(`/api/terminal/stream?terminalId=${encodeURIComponent(activeTerminalId)}`)
    eventSourceRef.current = eventSource

    logDebug("connect eventsource", { url: "/api/terminal/stream", terminalId: activeTerminalId })

    eventSource.addEventListener("open", async () => {
      logDebug("eventsource opened", { terminalId: activeTerminalId })
      lastResizeRef.current = { cols: terminal.cols, rows: terminal.rows }
      await sendResize(terminal.cols, terminal.rows)
    })

    eventSource.addEventListener("output", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as ClientServerMessage

        if (parsed.type === "terminal.output") {
          terminal.write(parsed.data)
        }
      } catch {
        logDebug("ignore invalid output event")
      }
    })

    eventSource.addEventListener("closed", () => {
      setTerminalIds((previous) => {
        const currentIndex = previous.indexOf(activeTerminalId)
        if (currentIndex < 0) {
          return previous
        }

        const next = previous.filter((id) => id !== activeTerminalId)
        const nextActive = next[currentIndex] ?? next[currentIndex - 1] ?? null
        setActiveTerminalId(nextActive)
        return next
      })

      void fetchSessions()
    })

    eventSource.addEventListener("error", () => {
      logDebug("eventsource error", { terminalId: activeTerminalId })
    })

    const terminalInputDisposable = terminal.onData((data) => {
      void sendInput(data)
    })

    const onResize = () => {
      fitAddon.fit()

      const next = { cols: terminal.cols, rows: terminal.rows }
      if (lastResizeRef.current && lastResizeRef.current.cols === next.cols && lastResizeRef.current.rows === next.rows) {
        return
      }

      lastResizeRef.current = next
      void sendResize(next.cols, next.rows)
    }

    window.addEventListener("resize", onResize)

    onResize()

    return () => {
      window.removeEventListener("resize", onResize)
      terminalInputDisposable.dispose()
      eventSource.close()
      terminal.dispose()
      eventSourceRef.current = null
      logDebug("eventsource closed", { terminalId: activeTerminalId })
    }
  }, [activeTerminalId, fetchSessions, isSessionReady, sendInput, sendResize])

  const onSubmit = useCallback<NonNullable<ComponentProps<"form">["onSubmit"]>>(
    (event) => {
      event.preventDefault()
      if (!inputValue) {
        return
      }
      void sendInput(`${inputValue}\r`)
      setInputValue("")
    },
    [inputValue, sendInput]
  )

  const onSpecialSubmit = useCallback<NonNullable<ComponentProps<"form">["onSubmit"]>>(
    (event) => {
      event.preventDefault()
      const expression = specialPresetRef.current?.value.trim() ?? ""
      if (!expression) {
        return
      }
      void sendSequence(expression)
      setSpecialExpression("")
      setIsSpecialDropdownOpen(false)
      if (specialPresetRef.current) {
        specialPresetRef.current.value = ""
      }
    },
    [sendSequence]
  )

  const currentIndex = activeTerminalId ? terminalIds.indexOf(activeTerminalId) : -1

  return (
    <div
      data-testid="terminal-page"
      className="grid h-svh w-full grid-rows-[auto_minmax(0,1fr)_auto_auto_auto] gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="terminal-active-label">
          {currentIndex >= 0 ? `Terminal ${currentIndex + 1} / ${terminalIds.length}` : "Terminal"}
        </p>
        <div className="flex items-center gap-2">
          {terminalIds.length > 1 ? (
            <>
              <Button
                type="button"
                variant="outline"
                data-testid="terminal-nav-prev"
                aria-label="이전 터미널"
                className="h-9 w-9 px-0 text-base font-semibold"
                onClick={() => switchTerminalByOffset(-1)}
              >
                ‹
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="terminal-nav-next"
                aria-label="다음 터미널"
                className="h-9 w-9 px-0 text-base font-semibold"
                onClick={() => switchTerminalByOffset(1)}
              >
                ›
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            data-testid="terminal-add"
            aria-label="terminal-add"
            onClick={() => void createTerminal()}
            className="h-9 min-w-9 px-3"
          >
            +
          </Button>
        </div>
      </div>

      <div
        data-testid="terminal-viewport-shell"
        className="relative min-h-0 overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_0_0_1px_var(--color-border)]"
        onTouchStart={(event) => {
          const touch = event.touches[0]
          touchStartRef.current = { x: touch.clientX, y: touch.clientY }
        }}
        onTouchEnd={(event) => {
          if (!touchStartRef.current) {
            return
          }

          const touch = event.changedTouches[0]
          const deltaX = touch.clientX - touchStartRef.current.x
          const deltaY = touch.clientY - touchStartRef.current.y

          touchStartRef.current = null

          if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) {
            return
          }

          if (Math.abs(deltaX) <= Math.abs(deltaY)) {
            return
          }

          if (deltaX < 0) {
            switchTerminalByOffset(1)
            return
          }

          switchTerminalByOffset(-1)
        }}
      >
        <div className="h-full p-2">
          <div data-testid="terminal-viewport" ref={containerRef} className="h-full w-full overflow-hidden bg-black" />
        </div>
      </div>

      <form onSubmit={onSubmit} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <input
          data-testid="terminal-input"
          aria-label="terminal-input"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Type a command and press Enter"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <Button
          variant="outline"
          data-testid="terminal-submit"
          aria-label="terminal-submit"
          type="submit"
          className="h-11 w-11 px-0 text-base"
        >
          ↵
        </Button>
      </form>

      <form onSubmit={onSpecialSubmit} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="relative min-w-0">
          <input
            data-testid="terminal-special-preset"
            aria-label="terminal-special-preset"
            ref={specialPresetRef}
            value={specialExpression}
            onChange={(event) => {
              setSpecialExpression(event.target.value)
              setIsSpecialDropdownOpen(true)
            }}
            onFocus={() => setIsSpecialDropdownOpen(true)}
            onBlur={() => {
              window.setTimeout(() => {
                setIsSpecialDropdownOpen(false)
              }, 120)
            }}
            placeholder="Select or type a shortcut (e.g., Ctrl+B D)"
            className="h-11 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <button
            type="button"
            data-testid="terminal-special-toggle"
            aria-label="특수 입력 목록 토글"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
            onMouseDown={(event) => {
              event.preventDefault()
              setIsSpecialDropdownOpen((prev) => !prev)
              if (specialPresetRef.current) {
                specialPresetRef.current.focus()
              }
            }}
          >
            {isSpecialDropdownOpen ? "▴" : "▾"}
          </button>
          {isSpecialDropdownOpen ? (
            <div
              data-testid="terminal-special-dropdown"
              className="absolute bottom-[calc(100%+0.25rem)] left-0 z-20 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
            >
              {SPECIAL_INPUT_PRESETS.filter((preset) =>
                preset.toLowerCase().includes(specialExpression.trim().toLowerCase())
              ).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    void sendSequence(preset)
                    setSpecialExpression("")
                    if (specialPresetRef.current) {
                      specialPresetRef.current.value = ""
                      specialPresetRef.current.focus()
                    }
                    setIsSpecialDropdownOpen(false)
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          variant="outline"
          data-testid="terminal-special-submit"
          aria-label="terminal-special-submit"
          type="submit"
          className="h-11 w-11 px-0 text-base"
        >
          ⚡
        </Button>
      </form>

    </div>
  )
}
