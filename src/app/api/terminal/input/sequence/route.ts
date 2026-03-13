import { NextResponse } from "next/server"

import { parseSequenceInputPayload, parseTerminalInputExpression } from "@/lib/terminal-protocol"
import { getTerminalRuntime } from "@/lib/terminal-runtime"

const DEFAULT_STEP_DELAY_MS = 80

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const payload = parseSequenceInputPayload(body)

  if (!payload) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  }

  const parsed = parseTerminalInputExpression(payload.expression)

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const runtime = getTerminalRuntime().getSessionRuntime(payload.terminalId)
  if (!runtime) {
    return NextResponse.json({ error: "terminal not found" }, { status: 404 })
  }

  await runtime.writeSequence(parsed.steps, { stepDelayMs: DEFAULT_STEP_DELAY_MS })

  return new Response(null, { status: 204 })
}
