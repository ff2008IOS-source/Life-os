import { test, expect } from "./fixtures";

test("SFU mail changes Life OS on its own: a moved exam and a dated deadline, both undoable", async ({
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
  const exam3 = await (
    await post("/api/v1/assessments", {
      course_id: course.data.id,
      title: "Exam 3",
      weight: 40,
      due_date: "2026-12-04",
    })
  ).json();
  const made = await post("/api/v1/updates", { action: "token" });
  expect(made.status(), await made.text()).toBe(200);
  const { token } = await made.json();
  const bad = await page.request.post("/api/internal/intake/email", {
    data: { emails: [] },
    headers: { Authorization: "Bearer lio_wrongwrongwrongwrongwrong" },
  });
  expect(bad.status()).toBe(401);
  // Older mail forwarded from Outlook arrives as an attached email.
  const eml = [
    "From: SFU Library <libcirc@sfu.ca>",
    "To: Player <player@sfu.ca>",
    "Subject: [TEST] Due Items",
    `Date: ${new Date().toUTCString()}`,
    "Message-ID: <old-1@sfu.ca>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Your library items are due Dec 18.",
  ].join("\r\n");
  const sent = await page.request.post("/api/internal/intake/email", {
    data: {
      emails: [
        {
          id: "msg-1",
          subject: "TEST 330: Exam 3 moved",
          from: "Prof Example <prof@sfu.ca>",
          date: new Date().toISOString(),
          body: "<p>Hi all, Exam 3 is rescheduled to December 9 in AQ 3150.</p>",
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
          subject: "[TEST] Holiday sale ends Dec 20",
          from: "Shop <news@example.invalid>",
          to: "someone@example.invalid",
          date: new Date().toISOString(),
          body: "40% off, due Dec 20.",
        },
        { id: "msg-5#0", raw: eml },
      ],
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(sent.status(), await sent.text()).toBe(200);
  // The exam move and the library email; not the reset or the shop.
  expect((await sent.json()).added).toBe(2);

  const academics = async () =>
    (
      await (await page.request.get("/api/v1/academics")).json()
    ).assessments.find((a: { id: string }) => a.id === exam3.data.id);
  expect((await academics()).due_date).toBe("2026-12-09");
  const tasks = async () =>
    (await (await page.request.get("/api/v1/tasks")).json()).data.filter(
      (t: { title: string; deleted_at: string | null }) =>
        t.title === "[TEST] Due Items" && !t.deleted_at,
    );
  expect(await tasks()).toHaveLength(1);
  expect((await tasks())[0].due_date).toBe("2026-12-18");

  // Today shows what changed; nothing lists the emails themselves.
  await page.goto("/");
  const card = page
    .getByRole("region", { name: "Updated from your mail" })
    .filter({ visible: true });
  await expect(card.getByText("moved to")).toBeVisible();
  await expect(card.getByText("[TEST] Due Items")).toBeVisible();
  await expect(page.getByText("Reset your password")).toHaveCount(0);
  await card.getByRole("button", { name: "Undo: Exam 3" }).click();
  await expect(card.getByText("moved to")).toHaveCount(0);
  expect((await academics()).due_date).toBe("2026-12-04");
  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);
  // The task stays after "Got it".
  expect(await tasks()).toHaveLength(1);
  await page.goto("/planner?section=inbox");
  await expect(page.getByRole("region", { name: "SFU mail" })).toHaveCount(0);
});
