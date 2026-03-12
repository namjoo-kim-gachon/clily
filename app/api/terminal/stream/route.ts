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
      for (const chunk of runtime.getBacklogSnapshot()) {
        controller.enqueue(encoder.encode(sseEvent("output", encodeTerminalOutputEvent(chunk))))
      }

      const unsubscribe = runtime.subscribe((data) => {
        controller.enqueue(encoder.encode(sseEvent("output", encodeTerminalOutputEvent(data))))
      })

      const unsubscribeClose = runtime.subscribeClose(() => {
        controller.enqueue(encoder.encode(sseEvent("closed", JSON.stringify({ type: "terminal.closed" }))))
        clearInterval(keepalive)
        unsubscribe()
        unsubscribeClose()
        controller.close()
      })

      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`))
      }, KEEPALIVE_INTERVAL_MS)

      const abortHandler = () => {
        clearInterval(keepalive)
        unsubscribe()
        unsubscribeClose()
        controller.close()
      }

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
