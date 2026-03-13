import { NextResponse } from "next/server"

import { parseTextInputPayload } from "@/lib/terminal-protocol"
import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const payload = parseTextInputPayload(body)

    if (!payload) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 })
    }

    const runtime = getTerminalRuntime().getSessionRuntime(payload.terminalId)
    if (!runtime) {
      return NextResponse.json({ error: "terminal not found" }, { status: 404 })
    }

    runtime.writeText(payload.data)

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error("[terminal-input-text] request failed", { error })
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
