"use client"

import {
  type ComponentProps,
  type RefObject,
  startTransition,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react"

import { useMobileEnvironment } from "@/hooks/use-mobile-environment"

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
const LAST_MANUAL_SHORTCUT_STORAGE_KEY = "terminal:last-manual-shortcut"
const LAST_SKILL_COMMAND_STORAGE_KEY = "terminal:last-skill-command"
const SKILL_COMMAND_PRESETS = ["/clear", "/resume", "/exit", "/simplify", "/context", "/compact", "/usage", "/model"] as const
const TERMINAL_SCROLLBACK_LINES = 256

function estimateTerminalDimensions(containerEl: HTMLElement | null, fontSize: number) {
  if (!containerEl) {
    return { cols: 80, rows: 24 }
  }

  // Measure actual monospace character width via canvas for accuracy
  let charWidth = fontSize * 0.6
  let charHeight = fontSize * 1.22

  try {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.font = `${fontSize}px monospace`
      const measured = ctx.measureText("W").width
      if (measured > 0) {
        charWidth = measured
      }
    }
  } catch {
    // fallback to estimate
  }

  const cols = Math.max(20, Math.floor(containerEl.clientWidth / charWidth))
  const rows = Math.max(5, Math.floor(containerEl.clientHeight / charHeight))
  return { cols, rows }
}

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

type TerminalSessionsState = {
  terminalIds: string[]
  activeTerminalId: string | null
  isSessionReady: boolean
}

type ShortcutInputState = {
  expression: string
  isDropdownOpen: boolean
  isExpressionManual: boolean
}

type ShortcutInputAction =
  | { type: "expressionChanged"; payload: { expression: string } }
  | { type: "presetSelected"; payload: { expression: string } }
  | { type: "dropdownOpened" }
  | { type: "dropdownClosed" }
  | { type: "dropdownToggled" }
  | { type: "expressionCleared" }

function shortcutInputReducer(state: ShortcutInputState, action: ShortcutInputAction): ShortcutInputState {
  switch (action.type) {
    case "expressionChanged":
      return {
        ...state,
        expression: action.payload.expression,
        isExpressionManual: true,
      }
    case "presetSelected":
      return {
        ...state,
        expression: action.payload.expression,
        isExpressionManual: false,
      }
    case "dropdownOpened":
      return {
        ...state,
        isDropdownOpen: true,
      }
    case "dropdownClosed":
      return {
        ...state,
        isDropdownOpen: false,
      }
    case "dropdownToggled":
      return {
        ...state,
        isDropdownOpen: !state.isDropdownOpen,
      }
    case "expressionCleared":
      return {
        expression: "",
        isDropdownOpen: false,
        isExpressionManual: false,
      }
    default:
      return state
  }
}

type TerminalSessionsAction =
  | {
      type: "sessionsSynced"
      payload: {
        terminalIds: string[]
        preferredActive?: string | null
        defaultTerminalId?: string
      }
    }
  | { type: "sessionsFailed" }
  | { type: "terminalCreated"; payload: { terminalId: string } }
  | { type: "activeTerminalChanged"; payload: { terminalId: string | null } }
  | { type: "activeTerminalRemoved"; payload: { terminalId: string } }

function terminalSessionsReducer(state: TerminalSessionsState, action: TerminalSessionsAction): TerminalSessionsState {
  switch (action.type) {
    case "sessionsSynced": {
      const nextActive = pickNextActive(
        action.payload.terminalIds,
        state.activeTerminalId,
        action.payload.preferredActive,
        action.payload.defaultTerminalId
      )

      return {
        terminalIds: action.payload.terminalIds,
        activeTerminalId: nextActive,
        isSessionReady: true,
      }
    }
    case "sessionsFailed":
      return {
        ...state,
        isSessionReady: true,
      }
    case "terminalCreated": {
      const nextIds = state.terminalIds.includes(action.payload.terminalId)
        ? state.terminalIds
        : [...state.terminalIds, action.payload.terminalId]

      return {
        ...state,
        terminalIds: nextIds,
        activeTerminalId: action.payload.terminalId,
      }
    }
    case "activeTerminalChanged":
      return {
        ...state,
        activeTerminalId: action.payload.terminalId,
      }
    case "activeTerminalRemoved": {
      const currentIndex = state.terminalIds.indexOf(action.payload.terminalId)
      if (currentIndex < 0) {
        return state
      }

      const nextIds = state.terminalIds.filter((id) => id !== action.payload.terminalId)
      const nextActive = nextIds[currentIndex] ?? nextIds[currentIndex - 1] ?? null

      return {
        ...state,
        terminalIds: nextIds,
        activeTerminalId: nextActive,
      }
    }
    default:
      return state
  }
}

type TerminalHeaderProps = {
  terminalIds: string[]
  activeTerminalId: string | null
  isCreatingTerminal: boolean
  isReattaching: boolean
  onSwitchOffset: (offset: number) => void
  onCreateTerminal: () => void
  onCloseTerminal: () => void
  onReattach: () => void
}

function TerminalHeader({
  terminalIds,
  activeTerminalId,
  isCreatingTerminal,
  isReattaching,
  onSwitchOffset,
  onCreateTerminal,
  onCloseTerminal,
  onReattach,
}: TerminalHeaderProps) {
  const currentIndex = activeTerminalId ? terminalIds.indexOf(activeTerminalId) : -1

  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground" data-testid="terminal-active-label">
        {currentIndex >= 0
          ? `Session[${activeTerminalId}] ${currentIndex + 1} / ${terminalIds.length}`
          : "Session"}
      </p>
      <div className="flex items-center gap-2">
        {terminalIds.length > 1 ? (
          <>
            <Button
              type="button"
              variant="outline"
              data-testid="terminal-nav-prev"
              aria-label="Previous terminal"
              className="h-9 w-9 px-0 text-base font-semibold"
              onClick={() => onSwitchOffset(-1)}
            >
              ‹
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="terminal-nav-next"
              aria-label="Next terminal"
              className="h-9 w-9 px-0 text-base font-semibold"
              onClick={() => onSwitchOffset(1)}
            >
              ›
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          data-testid="terminal-reattach"
          aria-label="Reattach disconnected sessions"
          onClick={onReattach}
          disabled={isReattaching}
          className="h-9 min-w-9 px-3"
          title="Reattach disconnected sessions"
        >
          {isReattaching ? "…" : "⟳"}
        </Button>
        <Button
          type="button"
          variant="outline"
          data-testid="terminal-add"
          aria-label="terminal-add"
          onClick={onCreateTerminal}
          disabled={isCreatingTerminal}
          className="h-9 min-w-9 px-3"
        >
          {isCreatingTerminal ? "…" : "+"}
        </Button>
        <Button
          type="button"
          variant="outline"
          data-testid="terminal-close"
          aria-label="Close terminal"
          onClick={onCloseTerminal}
          className="h-9 w-9 px-0 text-base font-semibold"
        >
          ✕
        </Button>
      </div>
    </div>
  )
}

type TerminalViewportProps = {
  terminalShellRef: RefObject<HTMLDivElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  isMobile: boolean
  onScrollToBottom: () => void
}

function TerminalViewport({ terminalShellRef, containerRef, isMobile, onScrollToBottom }: TerminalViewportProps) {
  return (
    <div
      ref={terminalShellRef}
      data-testid="terminal-viewport-shell"
      className="relative h-full min-h-0 overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_0_0_1px_var(--color-border)]"
    >
      <div className="h-full p-2">
        <div data-testid="terminal-viewport" ref={containerRef} className="h-full w-full overflow-hidden bg-black touch-none" />
      </div>
      {isMobile && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/60 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white/90"
          title="Scroll to bottom"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  )
}

type TerminalCommandInputFormProps = {
  inputValue: string
  showSubmitButton: boolean
  onInputValueChange: (value: string) => void
  onSubmit: NonNullable<ComponentProps<"form">["onSubmit"]>
  onSubmitEnterOnly: () => void
}

function TerminalCommandInputForm({
  inputValue,
  showSubmitButton,
  onInputValueChange,
  onSubmit,
  onSubmitEnterOnly,
}: TerminalCommandInputFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={showSubmitButton ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" : "grid grid-cols-[minmax(0,1fr)] items-center gap-2"}
    >
      <input
        data-testid="terminal-input"
        aria-label="terminal-input"
        value={inputValue}
        onChange={(event) => onInputValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || inputValue) {
            return
          }
          event.preventDefault()
          onSubmitEnterOnly()
        }}
        placeholder="Type a command and press Enter"
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {showSubmitButton ? (
        <Button
          variant="outline"
          data-testid="terminal-submit"
          aria-label="terminal-submit"
          type="submit"
          className="h-11 w-11 px-0 text-base"
          onClick={(event) => {
            if (inputValue) {
              return
            }
            event.preventDefault()
            onSubmitEnterOnly()
          }}
        >
          ↵
        </Button>
      ) : null}
    </form>
  )
}

type TerminalShortcutFormProps = {
  expression: string
  isDropdownOpen: boolean
  isSkillDropdownOpen: boolean
  onExpressionChange: (expression: string) => void
  onToggleDropdown: () => void
  onToggleSkillDropdown: () => void
  onSubmit: NonNullable<ComponentProps<"form">["onSubmit"]>
  onSelectPreset: (preset: string) => void
  onSelectSkillCommand: (command: string) => void
  manualShortcutPreset: string | null
  recentSkillCommand: string | null
}

function TerminalShortcutForm({
  expression,
  isDropdownOpen,
  isSkillDropdownOpen,
  onExpressionChange,
  onToggleDropdown,
  onToggleSkillDropdown,
  onSubmit,
  onSelectPreset,
  onSelectSkillCommand,
  manualShortcutPreset,
  recentSkillCommand,
}: TerminalShortcutFormProps) {
  const filteredBuiltInPresets = SPECIAL_INPUT_PRESETS.filter((preset) =>
    preset.toLowerCase().includes(expression.trim().toLowerCase())
  )
  const filteredPresets =
    manualShortcutPreset && manualShortcutPreset.toLowerCase().includes(expression.trim().toLowerCase())
      ? [
          manualShortcutPreset,
          ...filteredBuiltInPresets.filter((preset) => preset.toLowerCase() !== manualShortcutPreset.toLowerCase()),
        ]
      : filteredBuiltInPresets

  const skillCommands = (recentSkillCommand ? [recentSkillCommand, ...SKILL_COMMAND_PRESETS] : SKILL_COMMAND_PRESETS).filter(
    (command, index, commands) => commands.indexOf(command) === index
  )

  const blurActiveElement = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }

  const handleTogglePress = () => {
    blurActiveElement()
    onToggleDropdown()
  }

  const handlePresetPress = (preset: string) => {
    blurActiveElement()
    onSelectPreset(preset)
  }

  const handleSkillCommandPress = (command: string) => {
    blurActiveElement()
    onSelectSkillCommand(command)
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-2">
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          data-testid="terminal-skill-toggle"
          aria-label="Toggle skill list"
          className="h-11 min-w-11 px-0 text-base"
          onClick={onToggleSkillDropdown}
        >
          ⌘
        </Button>
        {isSkillDropdownOpen ? (
          <div
            data-testid="terminal-skill-dropdown"
            className="absolute bottom-[calc(100%+0.25rem)] left-0 z-20 max-h-52 min-w-32 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
          >
            {skillCommands.map((command) => (
              <button
                key={command}
                type="button"
                className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => handleSkillCommandPress(command)}
              >
                {command}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
        <Button
          type="button"
          variant="outline"
          data-testid="terminal-special-toggle"
          aria-label="Toggle shortcut list"
          className="h-11 min-w-11 px-0 text-base"
          onClick={handleTogglePress}
        >
          ⌨
        </Button>
        <input
          data-testid="terminal-special-preset"
          aria-label="terminal-special-preset"
          value={expression}
          onChange={(event) => onExpressionChange(event.target.value)}
          placeholder="Select or type a shortcut (e.g., Ctrl+B D)"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {isDropdownOpen ? (
          <div
            data-testid="terminal-special-dropdown"
            className="absolute bottom-[calc(100%+0.25rem)] left-0 z-20 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
          >
            {filteredPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => handlePresetPress(preset)}
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
  )
}

type UseShortcutHandlersParams = {
  dispatchShortcut: (action: ShortcutInputAction) => void
  expression: string
  isExpressionManual: boolean
  sendSequence: (expression: string) => Promise<void>
  onManualExpressionSubmitted: (expression: string) => void
  onBeforeSpecialSubmit?: () => void
}

function useShortcutHandlers({
  dispatchShortcut,
  expression,
  isExpressionManual,
  sendSequence,
  onManualExpressionSubmitted,
  onBeforeSpecialSubmit,
}: UseShortcutHandlersParams) {
  const resetShortcutInput = useCallback(() => {
    dispatchShortcut({ type: "expressionCleared" })
  }, [dispatchShortcut])

  const onSelectPreset = useCallback(
    (preset: string) => {
      dispatchShortcut({ type: "presetSelected", payload: { expression: preset } })
      dispatchShortcut({ type: "dropdownClosed" })
      void sendSequence(preset)
    },
    [dispatchShortcut, sendSequence]
  )

  const onSpecialSubmit = useCallback<NonNullable<ComponentProps<"form">["onSubmit"]>>(
    (event) => {
      event.preventDefault()
      const trimmedExpression = expression.trim()
      if (!trimmedExpression) {
        return
      }
      onBeforeSpecialSubmit?.()
      if (isExpressionManual) {
        onManualExpressionSubmitted(trimmedExpression)
      }
      void sendSequence(trimmedExpression)
      resetShortcutInput()
    },
    [
      expression,
      isExpressionManual,
      onBeforeSpecialSubmit,
      onManualExpressionSubmitted,
      resetShortcutInput,
      sendSequence,
    ]
  )

  const onExpressionChange = useCallback(
    (nextExpression: string) => {
      dispatchShortcut({ type: "expressionChanged", payload: { expression: nextExpression } })
    },
    [dispatchShortcut]
  )

  const onToggleDropdown = useCallback(() => {
    dispatchShortcut({ type: "dropdownToggled" })
  }, [dispatchShortcut])

  return { onSelectPreset, onSpecialSubmit, onExpressionChange, onToggleDropdown }
}

type UseTouchSwipeNavigationParams = {
  terminalShellRef: RefObject<HTMLDivElement | null>
  switchTerminalByOffset: (offset: number) => void
}

function useTouchSwipeNavigation({ terminalShellRef, switchTerminalByOffset }: UseTouchSwipeNavigationParams) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const terminalShell = terminalShellRef.current
    if (!terminalShell) {
      return
    }

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) {
        return
      }

      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (!touchStartRef.current) {
        return
      }

      const touch = event.changedTouches[0]
      if (!touch) {
        touchStartRef.current = null
        return
      }

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
    }

    terminalShell.addEventListener("touchstart", handleTouchStart, { passive: true })
    terminalShell.addEventListener("touchend", handleTouchEnd, { passive: true })

    return () => {
      terminalShell.removeEventListener("touchstart", handleTouchStart)
      terminalShell.removeEventListener("touchend", handleTouchEnd)
    }
  }, [terminalShellRef, switchTerminalByOffset])
}

function useInitialSessionsLoad(fetchSessions: (preferredActive?: string | null) => Promise<void>) {
  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])
}

type UseTerminalRuntimeConnectionParams = {
  containerRef: RefObject<HTMLDivElement | null>
  terminalRef: RefObject<{ scrollToBottom: () => void } | null>
  activeTerminalId: string | null
  isSessionReady: boolean
  sendInput: (data: string) => Promise<void>
  sendResize: (cols: number, rows: number) => Promise<void>
  fetchSessions: (preferredActive?: string | null) => Promise<void>
  dispatchSessions: (action: TerminalSessionsAction) => void
  eventSourceRef: RefObject<EventSource | null>
  onOpenFile?: (path: string) => void
}

function useTerminalRuntimeConnection({
  containerRef,
  terminalRef,
  activeTerminalId,
  isSessionReady,
  sendInput,
  sendResize,
  fetchSessions,
  dispatchSessions,
  eventSourceRef,
  onOpenFile,
}: UseTerminalRuntimeConnectionParams) {
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current || !activeTerminalId || !isSessionReady) {
      return
    }

    let disposed = false
    let cleanupRuntime = () => {}

    const setup = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      if (disposed || !containerRef.current) {
        return
      }

      const terminal = new Terminal({
        cursorBlink: true,
        scrollback: TERMINAL_SCROLLBACK_LINES,
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
      terminalRef.current = { scrollToBottom: () => terminal.scrollToBottom() }

      // Mobile vertical scroll: intercept touch events in capture phase before xterm handles them,
      // then use terminal.scrollLines() to scroll the xterm buffer directly.
      let touchScrollStartY = 0
      let touchScrollStartX = 0
      let touchScrollLastY = 0
      let isVerticalScroll = false

      const onTouchStartForScroll = (ev: TouchEvent) => {
        const t = ev.touches[0]
        if (!t) return
        touchScrollStartX = t.clientX
        touchScrollStartY = t.clientY
        touchScrollLastY = t.clientY
        isVerticalScroll = false
      }

      const onTouchMoveForScroll = (ev: TouchEvent) => {
        const t = ev.touches[0]
        if (!t) return
        const totalDx = Math.abs(t.clientX - touchScrollStartX)
        const totalDy = t.clientY - touchScrollStartY

        if (!isVerticalScroll && Math.abs(totalDy) < 6) return

        if (!isVerticalScroll) {
          if (Math.abs(totalDy) > totalDx) {
            isVerticalScroll = true
          } else {
            return
          }
        }

        ev.stopPropagation()

        const deltaY = t.clientY - touchScrollLastY
        touchScrollLastY = t.clientY

        // Negative deltaY = finger moving up = scroll down (forward)
        const lines = -Math.round(deltaY / 14)
        if (lines !== 0) {
          terminal.scrollLines(lines)
        }
      }

      const scrollEl = containerRef.current
      if (scrollEl) {
        scrollEl.addEventListener('touchstart', onTouchStartForScroll, { passive: true, capture: true })
        scrollEl.addEventListener('touchmove', onTouchMoveForScroll, { passive: true, capture: true })
      }

      const streamUrl = `/api/terminal/stream?terminalId=${encodeURIComponent(activeTerminalId)}`
      const eventSource = new EventSource(streamUrl)
      eventSourceRef.current = eventSource

      logDebug("connect eventsource", { url: streamUrl, terminalId: activeTerminalId })

      eventSource.addEventListener("open", () => {
        logDebug("eventsource opened", { terminalId: activeTerminalId })
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
        startTransition(() => {
          dispatchSessions({ type: "activeTerminalRemoved", payload: { terminalId: activeTerminalId } })
        })

        void fetchSessions()
      })

      eventSource.addEventListener("editor.open", (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent).data) as { path: string }
          if (parsed.path) onOpenFile?.(parsed.path)
        } catch {
          // ignore malformed events
        }
      })

      eventSource.addEventListener("error", () => {
        logDebug("eventsource error", { terminalId: activeTerminalId })
        console.warn("[terminal-viewer] eventsource error", { terminalId: activeTerminalId })
      })

      // xterm.js auto-responds to DA (Device Attributes) queries from the PTY.
      // Forwarding these responses back to the PTY causes the shell to echo
      // garbage text like "1;2c" at the prompt. Filter them out here.
      const DA_RESPONSE_PATTERN = /\x1b\[[?>][0-9;]*c|\x9b[?>][0-9;]*c/g

      const terminalInputDisposable = terminal.onData((data: string) => {
        const filtered = data.replace(DA_RESPONSE_PATTERN, "")
        if (filtered) {
          void sendInput(filtered)
        }
      })

      lastResizeRef.current = null

      const syncTerminalSize = () => {
        fitAddon.fit()

        const next = { cols: terminal.cols, rows: terminal.rows }
        if (lastResizeRef.current && lastResizeRef.current.cols === next.cols && lastResizeRef.current.rows === next.rows) {
          return
        }

        lastResizeRef.current = next
        void sendResize(next.cols, next.rows)
      }

      let syncDebounceId: number | null = null
      let orientationSyncTimeout: number | null = null

      // Debounce with setTimeout so rapid consecutive resize events (e.g. mobile keyboard
      // show/hide spanning many frames) collapse into a single PTY resize call.
      const requestSyncTerminalSize = () => {
        if (syncDebounceId !== null) {
          window.clearTimeout(syncDebounceId)
        }

        syncDebounceId = window.setTimeout(() => {
          syncDebounceId = null
          syncTerminalSize()
        }, 200)
      }

      const onResize = () => {
        requestSyncTerminalSize()
      }

      const onOrientationChange = () => {
        requestSyncTerminalSize()

        // Extra delay after orientation change for layout to fully settle
        if (orientationSyncTimeout !== null) {
          window.clearTimeout(orientationSyncTimeout)
        }

        orientationSyncTimeout = window.setTimeout(() => {
          orientationSyncTimeout = null
          syncTerminalSize()
        }, 400)
      }

      const visualViewport = window.visualViewport
      const onVisualViewportResize = () => {
        requestSyncTerminalSize()
      }

      const resizeObserver = new ResizeObserver(() => {
        requestSyncTerminalSize()
      })
      resizeObserver.observe(containerRef.current)

      window.addEventListener("resize", onResize)
      window.addEventListener("orientationchange", onOrientationChange)

      if (visualViewport) {
        visualViewport.addEventListener("resize", onVisualViewportResize)
      }

      syncTerminalSize()

      cleanupRuntime = () => {
        if (syncDebounceId !== null) {
          window.clearTimeout(syncDebounceId)
          syncDebounceId = null
        }

        if (orientationSyncTimeout !== null) {
          window.clearTimeout(orientationSyncTimeout)
          orientationSyncTimeout = null
        }

        resizeObserver.disconnect()
        window.removeEventListener("resize", onResize)
        window.removeEventListener("orientationchange", onOrientationChange)
        if (visualViewport) {
          visualViewport.removeEventListener("resize", onVisualViewportResize)
        }
        if (scrollEl) {
          scrollEl.removeEventListener('touchstart', onTouchStartForScroll, { capture: true })
          scrollEl.removeEventListener('touchmove', onTouchMoveForScroll, { capture: true, passive: false } as EventListenerOptions)
        }
        terminalInputDisposable?.dispose()
        eventSource.close()
        terminal.dispose()
        terminalRef.current = null
      }
    }

    void setup()

    return () => {
      disposed = true
      cleanupRuntime()
      eventSourceRef.current = null
      logDebug("eventsource closed", { terminalId: activeTerminalId })
    }
  }, [activeTerminalId, containerRef, dispatchSessions, eventSourceRef, fetchSessions, isSessionReady, sendInput, sendResize])
}

function usePersistedTerminalPresets() {
  const [manualShortcutPreset, setManualShortcutPreset] = useState<string | null>(null)
  const [recentSkillCommand, setRecentSkillCommand] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LAST_MANUAL_SHORTCUT_STORAGE_KEY)
      if (stored) setManualShortcutPreset(stored)
    } catch {
      logDebug("failed to load manual shortcut")
    }
  }, [])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LAST_SKILL_COMMAND_STORAGE_KEY)
      if (stored) setRecentSkillCommand(stored)
    } catch {
      logDebug("failed to load skill command")
    }
  }, [])

  const saveManualShortcut = useCallback((nextExpression: string) => {
    setManualShortcutPreset(nextExpression)
    try {
      window.localStorage.setItem(LAST_MANUAL_SHORTCUT_STORAGE_KEY, nextExpression)
    } catch {
      logDebug("failed to save manual shortcut")
    }
  }, [])

  const saveSkillCommand = useCallback((nextCommand: string) => {
    setRecentSkillCommand(nextCommand)
    try {
      window.localStorage.setItem(LAST_SKILL_COMMAND_STORAGE_KEY, nextCommand)
    } catch {
      logDebug("failed to save skill command")
    }
  }, [])

  return { manualShortcutPreset, recentSkillCommand, saveManualShortcut, saveSkillCommand }
}

export function TerminalViewer({ embedded = false, onOpenFile }: { embedded?: boolean; onOpenFile?: (path: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalShellRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<{ scrollToBottom: () => void } | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const createTerminalLockRef = useRef(false)
  const [inputValue, setInputValue] = useState("")
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false)
  const [isReattaching, setIsReattaching] = useState(false)
  const [isSkillDropdownOpen, setIsSkillDropdownOpen] = useState(false)
  const isMobileEnvironment = useMobileEnvironment()
  const { manualShortcutPreset, recentSkillCommand, saveManualShortcut, saveSkillCommand } = usePersistedTerminalPresets()
  const [shortcutState, dispatchShortcut] = useReducer(shortcutInputReducer, {
    expression: "",
    isDropdownOpen: false,
    isExpressionManual: false,
  })
  const [sessionsState, dispatchSessions] = useReducer(terminalSessionsReducer, {
    terminalIds: [],
    activeTerminalId: null,
    isSessionReady: false,
  })

  const { terminalIds, activeTerminalId, isSessionReady } = sessionsState
  const {
    expression: specialExpression,
    isDropdownOpen: isSpecialDropdownOpen,
    isExpressionManual: isSpecialExpressionManual,
  } = shortcutState

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
      startTransition(() => {
        dispatchSessions({ type: "sessionsFailed" })
      })
      return
    }

    const payload = (await response.json()) as SessionsResponse
    startTransition(() => {
      dispatchSessions({
        type: "sessionsSynced",
        payload: {
          terminalIds: payload.terminalIds,
          preferredActive,
          defaultTerminalId: payload.defaultTerminalId,
        },
      })
    })
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
      dispatchSessions({ type: "activeTerminalChanged", payload: { terminalId: terminalIds[nextIndex] } })
    },
    [activeTerminalId, terminalIds]
  )

  const createTerminal = useCallback(async () => {
    if (createTerminalLockRef.current) {
      return
    }

    createTerminalLockRef.current = true
    setIsCreatingTerminal(true)

    try {
      // Estimate terminal dimensions from the container so the PTY starts at the
      // correct size and zsh never needs to redraw (avoids the initial % artifact).
      const initialDims = estimateTerminalDimensions(containerRef.current, 14)
      const response = await fetch("/api/terminal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initialDims),
      })
      if (!response.ok) {
        logDebug("create session failed", { status: response.status })
        return
      }

      const payload = (await response.json()) as CreateSessionResponse
      dispatchSessions({ type: "terminalCreated", payload: { terminalId: payload.terminalId } })
    } finally {
      createTerminalLockRef.current = false
      setIsCreatingTerminal(false)
    }
  }, [])

  const closeTerminal = useCallback(async () => {
    if (!activeTerminalId) {
      return
    }

    if (!window.confirm("Close this terminal?")) {
      return
    }

    const response = await fetch("/api/terminal/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId: activeTerminalId }),
    })

    if (!response.ok) {
      logDebug("close terminal failed", { status: response.status })
      return
    }

    dispatchSessions({ type: "activeTerminalRemoved", payload: { terminalId: activeTerminalId } })
  }, [activeTerminalId, dispatchSessions])

  const reattachSessions = useCallback(async () => {
    if (isReattaching) return
    setIsReattaching(true)
    try {
      const response = await fetch("/api/terminal/reattach", { method: "POST" })
      if (!response.ok) return
      await fetchSessions()
    } finally {
      setIsReattaching(false)
    }
  }, [isReattaching, fetchSessions])

  useTouchSwipeNavigation({ terminalShellRef, switchTerminalByOffset })
  useInitialSessionsLoad(fetchSessions)
  useTerminalRuntimeConnection({
    containerRef,
    terminalRef,
    activeTerminalId,
    isSessionReady,
    sendInput,
    sendResize,
    fetchSessions,
    dispatchSessions,
    eventSourceRef,
    onOpenFile,
  })

  const onSubmit = useCallback<NonNullable<ComponentProps<"form">["onSubmit"]>>(
    (event) => {
      event.preventDefault()
      void sendInput(`${inputValue}\r`)
      setInputValue("")
    },
    [inputValue, sendInput]
  )

  const onSubmitEnterOnly = useCallback(() => {
    void sendInput("\r")
  }, [sendInput])


  const { onSelectPreset, onSpecialSubmit, onExpressionChange, onToggleDropdown } = useShortcutHandlers({
    dispatchShortcut,
    expression: specialExpression,
    isExpressionManual: isSpecialExpressionManual,
    sendSequence,
    onManualExpressionSubmitted: saveManualShortcut,
  })

  const handleToggleSpecialDropdown = useCallback(() => {
    if (!isSpecialDropdownOpen) {
      setIsSkillDropdownOpen(false)
    }
    onToggleDropdown()
  }, [isSpecialDropdownOpen, onToggleDropdown])

  const handleToggleSkillDropdown = useCallback(() => {
    setIsSkillDropdownOpen((isOpen) => {
      const nextIsOpen = !isOpen
      if (nextIsOpen) {
        dispatchShortcut({ type: "dropdownClosed" })
      }
      return nextIsOpen
    })
  }, [dispatchShortcut])

  const handleSelectSkillCommand = useCallback(
    (command: string) => {
      void sendInput(`${command}\r`)
      saveSkillCommand(command)
      setIsSkillDropdownOpen(false)
    },
    [saveSkillCommand, sendInput]
  )

  return (
    <div
      data-testid="terminal-page"
      className={
        isMobileEnvironment
          ? "fixed inset-0 box-border grid grid-rows-[auto_minmax(0,1fr)_auto_auto_auto] gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3"
          : embedded
            ? "h-full box-border grid grid-rows-[auto_minmax(0,1fr)] gap-2 p-2"
            : "fixed inset-0 box-border grid grid-rows-[auto_minmax(0,1fr)] gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] h-dvh"
      }
    >
      <TerminalHeader
        terminalIds={terminalIds}
        activeTerminalId={activeTerminalId}
        isCreatingTerminal={isCreatingTerminal}
        isReattaching={isReattaching}
        onSwitchOffset={switchTerminalByOffset}
        onCreateTerminal={() => void createTerminal()}
        onCloseTerminal={() => void closeTerminal()}
        onReattach={() => void reattachSessions()}
      />

      <TerminalViewport
        terminalShellRef={terminalShellRef}
        containerRef={containerRef}
        isMobile={isMobileEnvironment}
        onScrollToBottom={() => terminalRef.current?.scrollToBottom()}
      />

      {isMobileEnvironment ? (
        <>
          <TerminalCommandInputForm
            inputValue={inputValue}
            showSubmitButton={isMobileEnvironment}
            onInputValueChange={setInputValue}
            onSubmit={onSubmit}
            onSubmitEnterOnly={onSubmitEnterOnly}
          />

          <TerminalShortcutForm
            expression={specialExpression}
            isDropdownOpen={isSpecialDropdownOpen}
            isSkillDropdownOpen={isSkillDropdownOpen}
            onExpressionChange={onExpressionChange}
            onToggleDropdown={handleToggleSpecialDropdown}
            onToggleSkillDropdown={handleToggleSkillDropdown}
            onSubmit={onSpecialSubmit}
            onSelectPreset={onSelectPreset}
            onSelectSkillCommand={handleSelectSkillCommand}
            manualShortcutPreset={manualShortcutPreset}
            recentSkillCommand={recentSkillCommand}
          />
        </>
      ) : null}
    </div>
  )
}
