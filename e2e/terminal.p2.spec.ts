import { expect, test } from "@playwright/test"

function parseActiveLabel(text: string) {
  const match = text.match(/Terminal\s+(\d+)\s*\/\s*(\d+)/)
  return {
    active: Number(match?.[1] ?? 0),
    total: Number(match?.[2] ?? 0),
  }
}

test.describe("P2 persistent terminal", () => {
  test("재연결 후에도 터미널 UI와 입력 전송이 유지된다", async ({ page }) => {
    await page.goto("/")

    const input = page.getByTestId("terminal-input")
    await input.fill(`echo reconnect-${Date.now()}`)
    await page.getByTestId("terminal-submit").click()
    await expect(input).toHaveValue("")

    await page.reload()

    await expect(page.getByTestId("terminal-page")).toBeVisible()

    const afterReloadInput = page.getByTestId("terminal-input")
    await afterReloadInput.fill("after-reconnect")
    await page.getByTestId("terminal-submit").click()

    await expect(afterReloadInput).toHaveValue("")
  })

  test("터미널에서 exit 입력 시 해당 터미널이 삭제된다", async ({ page }) => {
    let exitedTerminalId = ""

    await page.route("**/api/terminal/input/text", async (route) => {
      const body = route.request().postDataJSON() as { data?: string; terminalId?: string }
      if (body.data === "exit\r") {
        exitedTerminalId = body.terminalId ?? ""
      }
      await route.continue()
    })

    await page.goto("/")
    await page.getByTestId("terminal-add").click()

    const input = page.getByTestId("terminal-input")
    await input.fill("exit")
    await page.getByTestId("terminal-submit").click()

    await expect.poll(() => exitedTerminalId).not.toBe("")

    await expect.poll(async () => {
      const response = await page.request.get("/api/terminal/sessions")
      const payload = (await response.json()) as { terminalIds: string[] }
      return payload.terminalIds.includes(exitedTerminalId)
    }).toBe(false)
  })

  test("마지막 터미널에서 exit 입력 후에도 새 터미널 1개를 유지한다", async ({ page }) => {
    await page.goto("/")

    const input = page.getByTestId("terminal-input")
    await input.fill("exit")
    await page.getByTestId("terminal-submit").click()

    await expect.poll(async () => parseActiveLabel((await page.getByTestId("terminal-active-label").textContent()) ?? "").total).toBeGreaterThanOrEqual(1)
    await expect(page.getByTestId("terminal-viewport")).toBeVisible()
  })
})
