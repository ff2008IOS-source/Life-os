import { test, expect } from "./fixtures";

test("Connect SFU Outlook explains the setup and starts a read-only Microsoft sign-in", async ({
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
  await page.goto("/settings?section=integrations");
  const panel = page.getByRole("region", { name: "SFU Outlook" });
  await expect(panel.getByText("Not connected")).toBeVisible();
  await panel.getByRole("button", { name: "Connect SFU Outlook" }).click();
  await expect(panel.getByText("/api/v1/outlook/callback")).toBeVisible();
  await panel.getByLabel("Application (client) ID").fill("not an id");
  await panel.getByRole("button", { name: "Sign in with SFU" }).click();
  await expect(panel.getByRole("alert")).toContainText("client) ID");
  // A valid id starts sign-in at Microsoft (intercepted here).
  await page.route("https://login.microsoftonline.com/**", (r) =>
    r.fulfill({ status: 200, body: "microsoft sign-in" }),
  );
  await panel
    .getByLabel("Application (client) ID")
    .fill("11111111-2222-3333-4444-555555555555");
  await panel.getByRole("button", { name: "Sign in with SFU" }).click();
  await page.waitForURL(
    /login\.microsoftonline\.com\/sfu\.ca\/oauth2\/v2\.0\/authorize/,
  );
  const url = new URL(page.url());
  expect(url.searchParams.get("scope")).toBe(
    "offline_access User.Read Mail.Read",
  );
  expect(url.searchParams.get("client_id")).toBe(
    "11111111-2222-3333-4444-555555555555",
  );
});
