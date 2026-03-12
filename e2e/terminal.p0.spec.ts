import { expect, test } from "@playwright/test"

test.describe("P0 terminal flow", () => {
  test("기본 터미널 뷰가 렌더링된다", async ({ page }) => {
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

  test("+ 버튼으로 터미널을 추가하고 활성 터미널로 전환한다", async ({ page }) => {
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

  test("활성 터미널의 terminalId로 입력을 전송한다", async ({ page }) => {
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
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].data).toBe("echo e2e-ok\r")
    expect(requests[0].terminalId).toBeTruthy()
  })

  test("특수 입력 드롭다운 선택 후 실행이 동작한다", async ({ page }) => {
    const requests: Array<{ expression: string; terminalId?: string }> = []

    await page.route("**/api/terminal/input/sequence", async (route) => {
      const request = route.request()
      const body = request.postDataJSON() as { expression?: string; terminalId?: string }
      requests.push({ expression: body.expression ?? "", terminalId: body.terminalId })
      await route.fulfill({ status: 204, body: "" })
    })

    await page.goto("/")

    const specialInput = page.getByTestId("terminal-special-preset")

    await specialInput.fill("ctrl+b")
    await expect(specialInput).toHaveValue("ctrl+b")

    await page.getByTestId("terminal-special-submit").click()
    await expect(specialInput).toHaveValue("")
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].expression).toBe("ctrl+b")
    expect(requests[0].terminalId).toBeTruthy()
  })

})
