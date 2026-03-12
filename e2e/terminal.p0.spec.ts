import { expect, test } from "@playwright/test"

test.describe("P0 terminal flow", () => {
  test("renders the default terminal view", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByTestId("terminal-page")).toBeVisible()
    await expect(page.getByTestId("terminal-viewport")).toBeVisible()
    await expect(page.getByTestId("terminal-input")).toBeVisible()
    await expect(page.getByTestId("terminal-submit")).toBeVisible()
    await expect(page.getByTestId("terminal-submit")).toHaveText("↵")
    await expect(page.getByTestId("terminal-special-preset")).toBeVisible()
    await expect(page.getByTestId("terminal-special-submit")).toBeVisible()
    await expect(page.getByTestId("terminal-add")).toBeVisible()
  })

  test("adds a terminal with + and switches to it", async ({ page }) => {
    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")

    await expect.poll(async () => {
      const text = (await label.textContent()) ?? ""
      const match = text.match(/Terminal\s+(\d+)\s*\/\s*(\d+)/)
      return Number(match?.[2] ?? 0)
    }).toBeGreaterThan(0)

    const beforeText = (await label.textContent()) ?? ""
    const beforeMatch = beforeText.match(/Terminal\s+(\d+)\s*\/\s*(\d+)/)
    const beforeTotal = Number(beforeMatch?.[2] ?? 0)

    await page.getByTestId("terminal-add").click()

    await expect.poll(async () => {
      const text = (await label.textContent()) ?? ""
      const match = text.match(/Terminal\s+(\d+)\s*\/\s*(\d+)/)
      return {
        active: Number(match?.[1] ?? 0),
        total: Number(match?.[2] ?? 0),
      }
    }).toEqual({
      active: beforeTotal + 1,
      total: beforeTotal + 1,
    })
  })

  test("sends input with the active terminalId", async ({ page }) => {
    const requests: Array<{ data: string; terminalId?: string }> = []

    await page.route("**/api/terminal/input/text", async (route) => {
      const request = route.request()
      const body = request.postDataJSON() as { data?: string; terminalId?: string }
      requests.push({ data: body.data ?? "", terminalId: body.terminalId })
      await route.fulfill({ status: 204, body: "" })
    })

    await page.goto("/")
    await page.getByTestId("terminal-add").click()

    const input = page.getByTestId("terminal-input")
    await input.fill("echo e2e-ok")
    await page.getByTestId("terminal-submit").click()

    await expect(input).toHaveValue("")
    await expect.poll(() => requests.some((request) => request.data === "echo e2e-ok\r")).toBe(true)
    const matched = requests.find((request) => request.data === "echo e2e-ok\r")
    expect(matched?.data).toBe("echo e2e-ok\r")
    expect(matched?.terminalId).toBeTruthy()
  })

  test("runs special input after selecting from the dropdown", async ({ page }) => {
    const requests: Array<{ expression: string; terminalId?: string }> = []

    await page.route("**/api/terminal/input/sequence", async (route) => {
      const request = route.request()
      const body = request.postDataJSON() as { expression?: string; terminalId?: string }
      requests.push({ expression: body.expression ?? "", terminalId: body.terminalId })
      await route.fulfill({ status: 204, body: "" })
    })

    await page.goto("/")

    const label = page.getByTestId("terminal-active-label")
    await expect.poll(async () => {
      const text = (await label.textContent()) ?? ""
      const match = text.match(/Terminal\s+(\d+)\s*\/\s*(\d+)/)
      return Number(match?.[2] ?? 0)
    }).toBeGreaterThan(0)

    const specialInput = page.getByTestId("terminal-special-preset")

    await specialInput.fill("ctrl+b")
    await expect(specialInput).toHaveValue("ctrl+b")

    await page.getByTestId("terminal-special-submit").click()
    await expect(specialInput).toHaveValue("")
    await expect.poll(() => requests.some((request) => request.expression === "ctrl+b")).toBe(true)
    const matched = requests.find((request) => request.expression === "ctrl+b")
    expect(matched?.expression).toBe("ctrl+b")
    expect(matched?.terminalId).toBeTruthy()
  })

})
