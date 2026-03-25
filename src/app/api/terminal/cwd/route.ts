import { NextResponse } from "next/server"

import { getTerminalRuntime } from "@/lib/terminal-runtime"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const terminalId = searchParams.get("terminalId") ?? undefined
  const cwd = getTerminalRuntime().getSessionCwd(terminalId)
  return NextResponse.json({ cwd: cwd ?? null })
}
