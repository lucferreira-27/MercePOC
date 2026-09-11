// Snapshot + zip: captures the running site (whole page + key regions,
// desktop + mobile) into outputs/snapshot-share/, zips it with repo source
// (minus node_modules/.git) into merce-poc-share.zip for sending.
//
// Usage:
//   1) npm run dev            (server on :4310)
//   2) node scripts/snapshot-share.mjs
//
// Env: TEST_BASE_URL (default http://127.0.0.1:4310), SKIP_ZIP=1 (screens only)
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
let pwPath = 'playwright';
if (process.env.PLAYWRIGHT_MODULE) {
  const st = fs.statSync(process.env.PLAYWRIGHT_MODULE);
  pwPath = pathToFileURL(
    st.isDirectory()
      ? path.join(process.env.PLAYWRIGHT_MODULE, 'index.js')
      : process.env.PLAYWRIGHT_MODULE,
  ).href;
}
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4310';
const out = 'outputs/snapshot-share';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

async function shoot(page, name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  console.log('shot:', name);
}

const browser = await chromium.launch(
  process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {},
);

try {
  // Desktop
  const desktop = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await desktop.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await shoot(page, '01-desktop-full.png');

  // Key regions of the desktop layout
  const regions = ['header', 'main', 'aside', 'nav', 'form', 'footer'];
  let i = 2;
  for (const sel of regions) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    try {
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: path.join(out, `${String(i).padStart(2, '0')}-desktop-${sel}.png`) });
      console.log('shot region:', sel);
      i++;
    } catch {
      /* region not visible — skip */
    }
  }

  // Mobile
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const mpage = await mobile.newPage();
  await mpage.goto(base, { waitUntil: 'networkidle' });
  await shoot(mpage, '50-mobile-full.png');

  await desktop.close();
  await mobile.close();
} finally {
  await browser.close();
}

if (process.env.SKIP_ZIP) process.exit(0);

// Zip: repo source (no node_modules/.git/.next) + screenshots, one archive.
const zipPath = 'merce-poc-share.zip';
if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
const hasPs = process.platform === 'win32';
try {
  if (hasPs) {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `
$ErrorActionPreference='Stop'
$tmp = Join-Path $env:TEMP "merce-share-$PID"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
 robocopy . (Join-Path $tmp 'repo') /E /XD node_modules .git .next outputs .turbo dist /XF merce-poc-share.zip .env .turn-retry.png .turn-failed.png /NFL /NDL /NJH /NJS
Copy-Item 'outputs/snapshot-share' (Join-Path $tmp 'screenshots') -Recurse
Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath 'merce-poc-share.zip' -Force
Remove-Item $tmp -Recurse -Force
`,
      ],
      { stdio: 'inherit' },
    );
  } else {
    fs.cpSync('outputs/snapshot-share', 'screenshots', { recursive: true });
    execFileSync('zip', ['-rq', zipPath, '.', '-x', 'node_modules/*', '.git/*', '.next/*', 'outputs/*', 'screenshots/*', '.env', 'merce-poc-share.zip']);
    fs.rmSync('screenshots', { recursive: true, force: true });
  }
} catch (e) {
  console.error('zip failed:', e.message);
  process.exit(1);
}
console.log('done ->', zipPath, '(', (fs.statSync(zipPath).size / 1e6).toFixed(1), 'MB ) and', out);
