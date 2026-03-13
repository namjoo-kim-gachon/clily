import { getTerminalRuntime } from "@/lib/terminal-runtime"
import { encodeTerminalOutputEvent } from "@/lib/terminal-protocol"

const encoder = new TextEncoder()
const KEEPALIVE_INTERVAL_MS = 15_000

function sseLine(value: string) {
  return `${value}\n`
}

function sseEvent(event: string, data: string) {
  return `${sseLine(`event: ${event}`)}${sseLine(`data: ${data}`)}\n`
}

export async function GET(request: Request) {
  const runtimeManager = getTerminalRuntime()
  const { searchParams } = new URL(request.url)
  const terminalId = searchParams.get("terminalId") ?? undefined
  const runtime = runtimeManager.getSessionRuntime(terminalId)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let keepalive: ReturnType<typeof setInterval> | null = null

      const safeEnqueue = (payload: string, reason: string) => {
        if (closed) {
          return false
        }

        try {
          controller.enqueue(encoder.encode(payload))
          return true
        } catch (error) {
          console.error("[terminal-stream] enqueue failed", { terminalId, reason, error })
          return false
        }
      }

      const unsubscribe = runtime.subscribe((data) => {
        const ok = safeEnqueue(sseEvent("output", encodeTerminalOutputEvent(data)), "runtime output")
        if (!ok) {
          cleanup("output enqueue failed")
        }
      })

      const unsubscribeClose = runtime.subscribeClose(() => {
        safeEnqueue(sseEvent("closed", JSON.stringify({ type: "terminal.closed" })), "runtime close")
        cleanup("runtime closed")
      })

      const abortHandler = () => {
        cleanup("request aborted")
      }

      const cleanup = (reason: string) => {
        if (closed) {
          return
        }

        closed = true

        if (keepalive) {
          clearInterval(keepalive)
          keepalive = null
        }

        request.signal.removeEventListener("abort", abortHandler)

        try {
          unsubscribe()
        } catch (error) {
          console.error("[terminal-stream] unsubscribe failed", { terminalId, reason, error })
        }

        try {
          unsubscribeClose()
        } catch (error) {
          console.error("[terminal-stream] close unsubscribe failed", { terminalId, reason, error })
        }

        try {
          controller.close()
        } catch (error) {
          console.error("[terminal-stream] close failed", { terminalId, reason, error })
        }
      }

      for (const chunk of runtime.getBacklogSnapshot()) {
        const ok = safeEnqueue(sseEvent("output", encodeTerminalOutputEvent(chunk)), "backlog replay")
        if (!ok) {
          cleanup("backlog enqueue failed")
          return
        }
      }

      keepalive = setInterval(() => {
        const ok = safeEnqueue(`: keepalive ${Date.now()}\n\n`, "keepalive")
        if (!ok) {
          cleanup("keepalive enqueue failed")
        }
      }, KEEPALIVE_INTERVAL_MS)

      request.signal.addEventListener("abort", abortHandler, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
