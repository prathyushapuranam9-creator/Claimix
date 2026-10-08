import { expect, test } from "@playwright/test";
import { alphaId, signIn } from "./helpers";

test("after registering, Details shows the patient number and the details can be downloaded", async ({ page, browser }) => {
  await signIn(page, "staff.a@demo.claimix.invalid");
  const name = `Download Test ${alphaId()}`;
  await page.goto("/patients/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Date of birth").fill("1990-03-04");
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  const number = (await page.getByRole("heading", { name }).locator("..").locator(".mono").first().innerText()).trim();
  expect(number).toMatch(/^PT-/);
  await expect(page.getByText("Patient number", { exact: true })).toBeVisible();
  await expect(page.getByText("Patient number", { exact: true }).locator("xpath=following::*[1]")).toHaveText(number);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download details" }).click()]);
  expect(download.suggestedFilename()).toBe(`patient-${number}.pdf`);
  const { readFile } = await import("node:fs/promises");
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  // The standard-font text in the PDF is stored as hex, so look for what the sheet must contain.
  const hex = pdf.toString("latin1");
  const has = (text: string) => hex.includes(Buffer.from(text, "latin1").toString("hex").toUpperCase());
  for (const text of ["Sunrise Multispeciality Hospital", "Patient Details", number, name, "Patient number", "Insurance & scheme coverage"]) expect(has(text), text).toBe(true);

  // Another hospital cannot download it.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signIn(p2, "staff.b@demo.claimix.invalid");
  const res = await p2.request.get(`/api/patients/${id}/export`);
  expect(res.status()).toBe(404);
  await other.close();
  expect((await page.request.get(`/api/patients/${id}/export`)).status()).toBe(200);
});
