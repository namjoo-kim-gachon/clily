import { readFileSync } from "node:fs"

import { IMAGE_MIME, resolvePath } from "@/lib/file-utils"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawPath = searchParams.get("path")

  if (!rawPath) {
    return new Response("path required", { status: 400 })
  }

  const filePath = resolvePath(rawPath)

  try {
    const buf = readFileSync(filePath)
    const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
    const contentType = IMAGE_MIME[ext] ?? "application/octet-stream"

    return new Response(buf, {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    })
  } catch {
    return new Response("not found", { status: 404 })
  }
}
