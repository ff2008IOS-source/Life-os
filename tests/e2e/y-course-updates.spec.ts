import { test, expect } from "./fixtures";

test("a forwarded course email that moves an exam shows on School and Today", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const initialize = page.getByRole("button", { name: /Set up my space/ });
  if (await initialize.count()) {
    await initialize.click();
    await expect(initialize).toHaveCount(0);
  }
  const post = (path: string, data: unknown) =>
    page.request.post(path, {
      data,
      headers: { Origin: "http://127.0.0.1:3000" },
    });
  const term = await (
    await post("/api/v1/academic_terms", { name: "[TEST] Updates term" })
  ).json();
  const course = await (
    await post("/api/v1/courses", {
      term_id: term.data.id,
      code: "TEST 330",
      title: "[TEST] Updates course",
    })
  ).json();
  // Settings creates the private link once.
  const made = await post("/api/v1/updates", { action: "token" });
  expect(made.status(), await made.text()).toBe(200);
  const { token } = await made.json();
  // A wrong token is refused.
  const bad = await page.request.post("/api/internal/intake/email", {
    data: { emails: [] },
    headers: { Authorization: "Bearer lio_wrongwrongwrongwrongwrong" },
  });
  expect(bad.status()).toBe(401);
  const sent = await page.request.post("/api/internal/intake/email", {
    data: {
      emails: [
        {
          id: "msg-1",
          subject: "TEST 330: Exam 3 moved to December 9",
          from: "Prof Example <prof@sfu.ca>",
          date: new Date().toISOString(),
          body: "<p>Hi all, Exam 3 is rescheduled to December 9 in AQ 3150.</p>",
        },
      ],
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(sent.status(), await sent.text()).toBe(200);
  expect((await sent.json()).added).toBe(1);
  await page.goto(`/areas/academics?course=${course.data.id}`);
  const updates = page
    .getByRole("region", { name: "Course updates" })
    .filter({ visible: true });
  await expect(
    updates.getByText("TEST 330: Exam 3 moved to December 9"),
  ).toBeVisible();
  await expect(updates.getByText("Date or time change")).toBeVisible();
  await page.goto("/");
  const today = page
    .getByRole("region", { name: "Course updates" })
    .filter({ visible: true });
  await expect(
    today.getByText("TEST 330: Exam 3 moved to December 9"),
  ).toBeVisible();
  await today
    .getByRole("button", { name: /Mark TEST 330: Exam 3 moved/ })
    .click();
  await expect(today).toHaveCount(0);
  // Other SFU mail lands in Week → Inbox; non-SFU mail and password resets
  // never do. Older mail forwarded as an attachment (.eml) is unpacked.
  const eml = [
    "From: SFU MBB <coach@sfu.ca>",
    "To: Player <player@sfu.ca>",
    "Subject: [TEST] Old practice schedule",
    "Date: Mon, 2 Nov 2026 09:00:00 -0800",
    "Message-ID: <old-1@sfu.ca>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Practice is at 6pm in the West Gym.",
  ].join("\r\n");
  const other = await page.request.post("/api/internal/intake/email", {
    data: {
      emails: [
        {
          id: "msg-2",
          subject: "[TEST] Team dinner Friday",
          from: "Teammate <mate@sfu.ca>",
          date: new Date().toISOString(),
          body: "Dinner is moved to 7pm.",
        },
        {
          id: "msg-3",
          subject: "Reset your password",
          from: "Accounts <no-reply@sfu.ca>",
          date: new Date().toISOString(),
          body: "Click to reset your password.",
        },
        {
          id: "msg-4",
          subject: "[TEST] Holiday sale",
          from: "Shop <news@example.invalid>",
          to: "someone@example.invalid",
          date: new Date().toISOString(),
          body: "40% off.",
        },
        { id: "msg-5#0", raw: eml },
      ],
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await other.json()).added).toBe(2);
  await page.goto("/planner?section=inbox");
  const mail = page.getByRole("region", { name: "Email" });
  await expect(mail.getByText("[TEST] Team dinner Friday")).toBeVisible();
  await expect(mail.getByText("[TEST] Old practice schedule")).toBeVisible();
  await expect(mail.getByText("Reset your password")).toHaveCount(0);
  await expect(mail.getByText("[TEST] Holiday sale")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByText("[TEST] Team dinner Friday")).toHaveCount(0);
});
