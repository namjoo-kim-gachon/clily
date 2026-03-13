import { NextResponse } from "next/server"

import { parseResizePayload } from "@/lib/terminal-protocol"
import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const payload = parseResizePayload(body)

    if (!payload) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 })
    }

    getTerminalRuntime().getSessionRuntime(payload.terminalId).resize(payload.cols, payload.rows)

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error("[terminal-resize] request failed", { error })
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
