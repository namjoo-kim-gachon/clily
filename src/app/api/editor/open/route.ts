import { resolve } from "node:path"

import { NextResponse } from "next/server"

import { getTerminalRuntime } from "@/lib/terminal-runtime"

const HOME = process.env.HOME ?? process.cwd()

function resolvePath(input: string): string {
  if (input.startsWith("~/")) return resolve(HOME, input.slice(2))
  if (input.startsWith("/")) return input
  return resolve(HOME, input)
}

export async function POST(request: Request) {
  const body = (await request.json()) as { path?: string }

  if (!body.path) {
    return NextResponse.json({ error: "path required" }, { status: 400 })
  }

  const path = resolvePath(body.path)
  getTerminalRuntime().broadcastEditorOpen(path)

  return NextResponse.json({ ok: true })
}
