import { expect, test, type Locator, type Page } from "@playwright/test";
import { IDS, signIn } from "./helpers";

const viewer = (page: Page) => page.getByRole("dialog");

/** Opens each row's eye icon in `table`, checking that the popup shows that row's own file, inside its bounds. */
async function checkRows(page: Page, table: Locator, max = 3) {
  const eyes = table.getByRole("button", { name: /^View / });
  const n = await eyes.count();
  expect(n).toBeGreaterThan(0);
  // Every row has its eye icon.
  expect(n).toBe(await table.locator("tbody tr").count());
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  for (let i = 0; i < Math.min(n, max); i++) {
    const eye = eyes.nth(i);
    const name = (await eye.getAttribute("aria-label"))!.replace(/^View /, "");
    const requested = page.waitForRequest((r) => /\/api\/documents\/[0-9a-f-]{36}$/.test(r.url()));
    await eye.click();
    const id = (await requested).url().split("/").pop()!;
    const d = viewer(page);
    await expect(d).toBeVisible();
    await expect(d.getByRole("heading", { level: 2 })).toHaveText(name);
    // The same document the row's Download link points to (where the row has one).
    const download = eye.locator("xpath=ancestor::tr").locator("a[href^='/api/documents/']:not(dialog a)");
    if (await download.count()) expect(await download.getAttribute("href")).toBe(`/api/documents/${id}`);

    const body = d.getByTestId("document-viewer-body");
    const shown = body.locator("iframe, img, [role=alert]");
    await expect(shown.first()).toBeVisible();
    // A downloadable row shows its file (PDF or image). The test fixtures are page-less placeholder
    // PDFs, which get a clear message with a Download link instead of the browser's own error.
    if (await download.count()) {
      const kind = await body.getAttribute("data-kind");
      if (kind === "error") {
        await expect(body.getByRole("alert")).toContainText("no pages to display");
        await expect(body.getByRole("link", { name: "Download" })).toHaveAttribute("href", `/api/documents/${id}`);
      } else {
        expect(["pdf", "image"]).toContain(kind);
        await expect(body.locator("iframe, img")).toHaveCount(1);
      }
    }
    // Contained: the content never extends past the popup, and the popup stays on screen.
    const dBox = (await d.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(dBox.x).toBeGreaterThanOrEqual(0);
    expect(dBox.x + dBox.width).toBeLessThanOrEqual(vp.width + 1);
    expect(dBox.y + dBox.height).toBeLessThanOrEqual(vp.height + 1);
    const bBox = (await body.boundingBox())!;
    expect(bBox.x + bBox.width).toBeLessThanOrEqual(dBox.x + dBox.width + 1);
    expect(bBox.y + bBox.height).toBeLessThanOrEqual(dBox.y + dBox.height + 1);
    const img = body.locator("img");
    if (await img.count()) expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth > 0 && el.getBoundingClientRect().width <= el.parentElement!.clientWidth + 1)).toBe(true);

    // Close: X, then Escape, then a click outside — each closes it.
    const how = ["x", "escape", "outside"][i % 3];
    if (how === "x") await d.getByRole("button", { name: "Close" }).click();
    else if (how === "escape") await page.keyboard.press("Escape");
    else await page.mouse.click(3, 3);
    await expect(viewer(page)).toHaveCount(0);
  }
  expect(errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
}

test.describe("Document viewer popup", () => {
  test("Patient profile → Policy Check → Documents: each row opens its own document", async ({ page }) => {
    await signIn(page, "staff.a@demo.claimix.invalid");
    await page.goto(`/patients/${IDS.patientA1}`);
    const block = page.locator("details[data-patient-id]");
    await block.locator("summary").click();
    await block.getByRole("tab", { name: "Documents" }).click();
    await checkRows(page, block.getByRole("table"));
    // Download is still there.
    await expect(block.getByRole("link", { name: "Download" }).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/patients/${IDS.patientA1}$`));
  });

  test("Insurer Reviewer: Documents page, pre-authorization and claim document lists", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await page.goto("/documents");
    // The uploaded-documents table (the "missing documents" table above it has no files to view).
    await checkRows(page, page.getByRole("table", { name: "Documents", exact: true }));

    await page.goto("/pre-authorizations");
    const preauth = page.locator("main table a[href^='/pre-authorizations/']").first();
    await preauth.click();
    await page.waitForURL(/\/pre-authorizations\/[0-9a-f-]{36}$/);
    const docs = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Treatment & supporting documents", exact: true }) }).getByRole("table");
    await expect(docs).toHaveCount(1);
    if (await docs.locator("tbody tr").count()) await checkRows(page, docs, 2);

    await page.goto("/claims");
    const claim = page.locator("main table a[href^='/claims/']").first();
    if (await claim.count()) {
      await claim.click();
      await page.waitForURL(/\/claims\/[0-9a-f-]{36}$/);
      const tables = page.locator("main section").filter({ has: page.getByRole("heading", { name: /Documents/ }) }).getByRole("table");
      for (let i = 0; i < (await tables.count()); i++) {
        if (await tables.nth(i).locator("tbody tr").count()) await checkRows(page, tables.nth(i), 1);
      }
    }
  });
});

test("Pre-authorization Decision box: fields stay inside the card", async ({ page }) => {
  await signIn(page, "insurer.a@demo.claimix.invalid");
  await page.goto("/pre-authorizations");
  const hrefs = await page.locator("main table a[href^='/pre-authorizations/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  for (const href of hrefs) {
    await page.goto(href);
    const card = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Decision", exact: true }) });
    if (!(await card.count())) continue;
    for (const to of ["query", "partially_approved", "rejected"]) {
      const sel = card.locator("select").first();
      if (!(await sel.locator(`option[value="${to}"]`).count())) continue;
      await sel.selectOption(to);
      const outside = await card.evaluate((c) => {
        const r = c.getBoundingClientRect();
        return [...c.querySelectorAll("input,select,textarea,button,label")]
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < r.left + 8 || b.right > r.right - 8); })
          .map((e) => e.outerHTML.slice(0, 80));
      });
      expect(outside, `${to}: elements touching or past the card edge`).toEqual([]);
    }
    return;
  }
  test.skip(true, "No pre-authorization awaiting a decision in the test data.");
});

test.describe("Document viewer: supported formats", () => {
  /** A genuine one-page PDF. */
  function realPdf() {
    const text = "BT /F1 24 Tf 72 720 Td (Claimix viewer test) Tj ET";
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let out = "%PDF-1.4\n";
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    return Buffer.from(out, "latin1");
  }

  test("PDF, PNG screenshot and JPG/JPEG each display inside the popup, keeping the image's shape", async ({ page }) => {
    await signIn(page, "insurer.a@demo.claimix.invalid");
    await page.goto("/documents");
    // Wide images (2400×600 — a typical screenshot strip) made in the browser, as PNG and JPEG.
    const [png, jpg] = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2400;
      c.height = 600;
      const g = c.getContext("2d")!;
      g.fillStyle = "#2a6f97";
      g.fillRect(0, 0, 2400, 600);
      g.fillStyle = "#fff";
      g.font = "120px sans-serif";
      g.fillText("Screenshot", 80, 340);
      return [c.toDataURL("image/png").split(",")[1]!, c.toDataURL("image/jpeg", 0.9).split(",")[1]!];
    });
    const files: [string, Buffer, string][] = [
      ["pdf", realPdf(), "application/pdf"],
      ["png", Buffer.from(png, "base64"), "image/png"],
      ["jpeg", Buffer.from(jpg, "base64"), "image/jpeg"],
    ];
    const eye = page.getByRole("table", { name: "Documents", exact: true }).getByRole("button", { name: /^View / }).first();

    for (const [kind, body, type] of files) {
      await page.unroute("**/api/documents/*");
      await page.route("**/api/documents/*", (r) => r.fulfill({ status: 200, contentType: type, body }));
      await eye.click();
      const d = viewer(page);
      const area = d.getByTestId("document-viewer-body");
      await expect(area).toHaveAttribute("data-kind", kind === "pdf" ? "pdf" : "image");
      const dBox = (await d.boundingBox())!;
      const aBox = (await area.boundingBox())!;

      if (kind === "pdf") {
        const frame = area.locator("iframe");
        await expect(frame).toHaveAttribute("src", /^blob:/);
        const fBox = (await frame.boundingBox())!;
        expect(fBox.x + fBox.width).toBeLessThanOrEqual(aBox.x + aBox.width + 1);
        expect(fBox.y + fBox.height).toBeLessThanOrEqual(dBox.y + dBox.height + 1);
      } else {
        const img = area.locator("img");
        await expect(img).toBeVisible();
        const m = await img.evaluate((el: HTMLImageElement) => ({ nw: el.naturalWidth, nh: el.naturalHeight, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
        expect(m.nw).toBe(2400);
        // Fit: inside the popup, same aspect ratio (no stretching).
        expect(m.w).toBeLessThanOrEqual(aBox.width + 1);
        expect(m.h).toBeLessThanOrEqual(aBox.height + 1);
        expect(Math.abs(m.w / m.h - m.nw / m.nh)).toBeLessThan(0.02);
        // Actual size: full resolution, scrolling inside the popup only.
        await d.getByRole("button", { name: "Actual size" }).click();
        await expect(img).toHaveJSProperty("width", 2400);
        expect(await area.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        expect((await d.boundingBox())!.width).toBeCloseTo(dBox.width, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await d.getByRole("button", { name: "Fit to window" }).click();
      }
      await d.getByRole("button", { name: "Close" }).click();
      await expect(viewer(page)).toHaveCount(0);
    }

    // Anything else is refused with a message, never rendered.
    await page.unroute("**/api/documents/*");
    await page.route("**/api/documents/*", (r) => r.fulfill({ status: 200, contentType: "image/png", body: "<html><script>alert(1)</script></html>" }));
    await eye.click();
    await expect(viewer(page).getByRole("alert")).toContainText("can't be previewed");
    await expect(viewer(page).locator("iframe, img")).toHaveCount(0);
  });
});
