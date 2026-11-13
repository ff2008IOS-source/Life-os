import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("one daily workspace preserves old links, saves planning boundaries safely and scopes materials to the mapped course", async ({
  page,
}) => {
  test.setTimeout(90000);
  const content = page.getByRole("main");
  const headers = { Origin: "http://127.0.0.1:3000" };
  expect((await page.request.get("/api/canvas/materials")).status()).toBe(401);
  expect(
    (
      await page.request.patch("/api/v1/schedule/automation", {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  await page.request.post("/api/v1/workspace/initialize", { headers });
  for (const [path, target] of [
    ["/briefing", "daily-briefing"],
    ["/assistant", "daily-briefing"],
    ["/notifications", "needs-attention"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/#[^/]*${target}$`));
    await expect(
      page.getByRole("heading", { name: "Needs Attention", exact: true }),
    ).toBeVisible();
  }
  await expect(
    page
      .locator(".sidebar")
      .getByRole("link", { name: "Briefing", exact: true }),
  ).toHaveCount(0);
  await page.goto("/settings?section=integrations");
  await expect(
    page.getByRole("heading", { name: "Automatic scheduling", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Open planning controls", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Scheduling preview" }),
  ).toHaveAttribute("aria-selected", "true");
  await content
    .getByText("Adjust planning boundaries", { exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Daily cap (minutes)", exact: true })
    .fill("120");
  await expect(
    page.getByRole("button", { name: "Turn on", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Save planning preferences", exact: true })
    .click();
  await expect(
    content.getByText("Planning preferences saved.", { exact: true }),
  ).toBeVisible();
  const saved = await (
    await page.request.get("/api/v1/schedule/automation")
  ).json();
  expect(saved.policy.max_daily_minutes).toBe(120);
  expect(saved.enabled).toBe(false);
  await page.reload();
  await content
    .getByText("Adjust planning boundaries", { exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Daily cap (minutes)", exact: true }),
  ).toHaveValue("120");
  const next = await page.request.patch("/api/v1/schedule/automation", {
    headers,
    data: {
      policy: { ...saved.policy, max_daily_minutes: 100 },
      version: saved.version,
    },
  });
  expect(next.status(), await next.text()).toBe(200);
  const stale = await page.request.patch("/api/v1/schedule/automation", {
    headers,
    data: { policy: saved.policy, version: saved.version },
  });
  expect(stale.status()).toBe(409);
  const denied = await page.request.patch("/api/v1/schedule/automation", {
    headers: { Origin: "https://untrusted.invalid" },
    data: { policy: saved.policy, version: saved.version },
  });
  expect(denied.status()).toBe(403);
  const latest = await (
    await page.request.get("/api/v1/schedule/automation")
  ).json();
  expect(latest.policy.max_daily_minutes).toBe(100);
  expect(latest.enabled).toBe(false);
  const off = await page.request.post("/api/v1/schedule/automation", {
    headers,
    data: { enabled: false, version: latest.version },
  });
  expect(off.status(), await off.text()).toBe(200);
  expect((await off.json()).policy.max_daily_minutes).toBe(100);

  const create = async (kind: string, data: unknown) => {
    const r = await page.request.post(`/api/v1/${kind}`, { headers, data });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data;
  };
  const term = await create("academic_terms", {
    name: "[TEST] Consolidation term",
  });
  const course = await create("courses", {
    term_id: term.id,
    code: "TEST 201",
    title: "[TEST] Consolidated course",
  });
  const mapping = await page.request.post(
    "http://127.0.0.1:54329/__fixtures/canvas-course",
    { data: { canvas_id: "771201", local_id: course.id } },
  );
  expect(mapping.status(), await mapping.text()).toBe(200);
  const materialResponse = await page.request.get(
    `/api/canvas/materials?local_course=${course.id}`,
  );
  expect(materialResponse.status(), await materialResponse.text()).toBe(200);
  const material = await materialResponse.json();
  expect(material.mapped_course).toBe("771201");
  expect(
    material.records.every(
      (r: { course: string | null; type: string; id: string }) =>
        r.course === "771201" || (r.type === "course" && r.id === "771201"),
    ),
  ).toBe(true);
  await page.goto(`/areas/academics?course=${course.id}&view=materials`);
  await expect(
    page.getByRole("button", { name: "Materials", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await content
    .locator(".course-materials .setting-line > summary")
    .filter({ hasText: "[TEST] Linked course" })
    .click();
  await expect(
    content.getByText("[TEST] Verified course reading", { exact: true }),
  ).toBeVisible();

  await content
    .getByText("Browse other Canvas courses", { exact: true })
    .click();
  const library = content
    .locator(".canvas-library-disclosure")
    .filter({ visible: true });
  const unavailable = "**/api/canvas/materials?page=0&course=771201";
  await page.route(unavailable, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Materials temporarily unavailable." } },
    }),
  );
  await library
    .getByRole("combobox", { name: "Canvas course", exact: true })
    .selectOption("771201");
  await expect(library).toContainText("Materials temporarily unavailable.");
  await expect(library.locator(".setting-line")).toHaveCount(0);
  await expect(
    library.getByRole("button", {
      name: "Prepare available files",
      exact: true,
    }),
  ).toBeDisabled();
  await page.unroute(unavailable);
  await library.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    library
      .locator(".setting-line > summary")
      .filter({ hasText: "[TEST] Linked course" }),
  ).toBeVisible();
  const unlinked = await create("courses", {
    term_id: term.id,
    code: "TEST 202",
    title: "[TEST] Unlinked course",
  });
  await page.goto(`/areas/academics?course=${unlinked.id}&view=materials`);
  await expect(content.getByText(/This course is not linked/)).toBeVisible();
  await expect(
    content.getByText("[TEST] Verified course reading", { exact: true }),
  ).toHaveCount(0);
  const reviewCourse = await create("courses", {
    term_id: term.id,
    code: "TEST 203",
    title: "[TEST] Mapping needs review",
  });
  await page.request.post("http://127.0.0.1:54329/__fixtures/canvas-course", {
    data: {
      canvas_id: "771203",
      local_id: reviewCourse.id,
      conflict: "Synthetic mapping conflict",
    },
  });
  const disputed = await (
    await page.request.get(
      `/api/canvas/materials?local_course=${reviewCourse.id}`,
    )
  ).json();
  expect(disputed.mapping_status).toBe("needs_review");
  expect(disputed.records).toEqual([]);
  await page.request.post("http://127.0.0.1:54329/__fixtures/canvas-course", {
    data: { canvas_id: "771204", local_id: reviewCourse.id },
  });
  const ambiguous = await (
    await page.request.get(
      `/api/canvas/materials?local_course=${reviewCourse.id}`,
    )
  ).json();
  expect(ambiguous.mapping_status).toBe("ambiguous");
  expect(ambiguous.records).toEqual([]);
  await page.goto("/canvas-materials");
  await expect(page).toHaveURL(/\/areas\/academics\?view=materials$/);
  await page.goto("/areas/projects");
  await expect(
    page
      .locator(".tabs")
      .getByRole("button", { name: "Projects", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Connected career and project records" }),
  ).toHaveCount(0);
  await page.goto("/more");
  await expect(
    page.getByRole("button", { name: "Dark", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Appearance & preferences" }).click();
  await expect(
    page.getByRole("combobox", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await page.goto(`/areas/academics?course=${course.id}&view=materials`);
  for (const [name, width] of [
    ["desktop", 1280],
    ["ipad", 834],
    ["phone", 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`consolidated-academics-${name}.png`),
      fullPage: true,
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
