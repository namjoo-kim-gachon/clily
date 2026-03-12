import { NextResponse } from "next/server"

import { parseTextInputPayload } from "@/lib/terminal-protocol"
import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const payload = parseTextInputPayload(body)

  if (!payload) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  }

  getTerminalRuntime().getSessionRuntime(payload.terminalId).writeText(payload.data)

  return new Response(null, { status: 204 })
}
