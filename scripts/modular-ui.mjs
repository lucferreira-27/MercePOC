import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PROFILE, preset, openingLimit } from '../lib/composition.ts';
import {
  normalize,
  executeRequest,
  cutCSV,
  cortecloud,
  canonical,
} from '../lib/studio.ts';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright'
);
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4310';
const out = 'outputs/modular';
fs.mkdirSync(out, { recursive: true });
async function post(body) {
  const r = await fetch(base + '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const p = await r.json();
  assert.ok(r.ok, p.error);
  return p;
}
let p = await post({ action: 'create' });
p = await post({
  id: p.id,
  version: p.version,
  action: 'rename',
  name: 'Modular · verificação visual',
});
let d = normalize({
  schemaVersion: 3,
  profile: PROFILE,
  modules: [{ ...preset('niche', 'a'), name: 'Base esquerda', height: 900 }],
  connections: [],
});
p = await post({
  id: p.id,
  version: p.version,
  action: 'update',
  design: d,
  label: 'Nicho inicial',
});
const batches = [
  [
    {
      kind: 'module.add',
      id: 'b',
      preset: 'niche',
      name: 'Base direita com painel compartilhado',
    },
    { kind: 'module.edit', id: 'b', height: 900 },
    {
      kind: 'connect',
      parent: 'a',
      child: 'b',
      side: 'right',
      shared: true,
      align: 'back',
      offset: 0,
    },
  ],
  [
    { kind: 'cell.split', id: 'a:root', axis: 'y', gapMm: 400 },
    { kind: 'front.set', id: 'a:root:low', type: 'drawers', count: 3 },
    { kind: 'front.set', id: 'a:root:high', type: 'double' },
  ],
  [
    {
      kind: 'module.add',
      id: 'c',
      preset: 'niche',
      name: 'Retorno perpendicular',
    },
    { kind: 'module.edit', id: 'c', width: 600, height: 900, rotation: 90 },
    {
      kind: 'connect',
      parent: 'b',
      child: 'c',
      side: 'right',
      shared: false,
      align: 'back',
      offset: 50,
    },
  ],
];
for (const ops of batches) {
  const result = executeRequest(d, ops);
  assert.ok(result.ok, result.error);
  d = result.design;
  p = await post({
    id: p.id,
    version: p.version,
    action: 'update',
    design: d,
    label: 'Composição com módulos compartilhados, gavetas e portas de abrir',
  });
}
fs.writeFileSync(out + '/lista-pecas.csv', cutCSV(d));
fs.writeFileSync(
  out + '/cortecloud.json',
  JSON.stringify(cortecloud(d), null, 2),
);
fs.writeFileSync(out + '/projeto.json', JSON.stringify(canonical(d), null, 2));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByLabel('Projeto atual').selectOption(p.id);
  await page.getByRole('heading', { name: p.name, exact: true }).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(
    await page.getByRole('button', { name: 'Cotas', exact: true }).count(),
    0,
  );
  await page.screenshot({
    path: out + '/desktop-composicao.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: /□ Compartimento.*gavetas/ }).click();
  await page
    .getByRole('button', { name: 'Abrir gaveta 1', exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole('button', { name: 'Abrir gaveta 1', exact: true })
    .click();
  await page.waitForTimeout(900);
  await page.screenshot({
    path: out + '/desktop-gaveta-aberta.png',
    fullPage: true,
  });
  const saved = await (await fetch(base + '/api/projects?id=' + p.id)).json();
  assert.equal(saved.revisions.length, p.revisions.length);
  await page
    .getByRole('button', { name: /□ Compartimento.*duas portas/ })
    .click();
  await page
    .getByRole('button', { name: 'Abrir porta 1', exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole('button', { name: 'Abrir porta 1', exact: true })
    .click();
  await page.waitForTimeout(900);
  await page.screenshot({
    path: out + '/desktop-porta-aberta.png',
    fullPage: true,
  });
  const slider = page.getByRole('slider');
  await slider.focus();
  await slider.press('Home');
  await page.waitForTimeout(600);
  await page.screenshot({
    path: out + '/desktop-historico-inicio.png',
    fullPage: true,
  });
  await slider.press('End');
  await page.waitForTimeout(900);
  await page.screenshot({
    path: out + '/desktop-historico-fim.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'horizontal overflow',
  );
  await page.screenshot({
    path: out + '/estreito-composicao.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await page
    .getByPlaceholder(/alternativa/)
    .fill('Alternativa com nome longo para verificar o layout estreito');
  await page
    .getByRole('button', {
      name: 'Criar alternativa desta versão',
      exact: true,
    })
    .click();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: out + '/estreito-alternativa.png',
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.screenshot({
    path: out + '/estreito-reduced-motion.png',
    fullPage: true,
  });
  const single = await post({
    id: p.id,
    version: (await (await fetch(base + '/api/projects?id=' + p.id)).json())
      .version,
    action: 'fork',
    cursor: 0,
    name: 'Uma versão',
  });
  await page.reload();
  await page.getByLabel('Projeto atual').selectOption(single.id);
  await page.waitForTimeout(400);
  assert.ok(await page.getByRole('slider').isDisabled());
  await page.screenshot({
    path: out + '/estreito-uma-versao.png',
    fullPage: true,
  });
  let many = await (await fetch(base + '/api/projects?id=' + p.id)).json();
  for (let i = 0; i < 20; i++) {
    const result = executeRequest(many.params, [
      { kind: 'module.edit', id: 'a', width: 800 + i },
    ]);
    assert.ok(result.ok);
    many = await post({
      id: many.id,
      version: many.version,
      action: 'update',
      design: result.design,
      label:
        i % 2
          ? 'Ajuste'
          : 'Uma descrição longa para testar o histórico com muitos módulos e compartimentos',
    });
  }
  await page.reload();
  await page.getByLabel('Projeto atual').selectOption(many.id);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: out + '/estreito-muitas-versoes.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(300);
  await page.getByRole('slider').focus();
  await page.getByRole('slider').press('Home');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: out + '/desktop-muitas-inicio.png',
    fullPage: true,
  });
  await page.getByRole('slider').press('End');
  await page.waitForTimeout(400);
  await page.screenshot({
    path: out + '/desktop-muitas-fim.png',
    fullPage: true,
  });
  const controlBox = await page.locator('.scene-bottom').boundingBox(),
    trackBox = await page.locator('.history-slider-wrap').boundingBox();
  await page.mouse.move(
    trackBox.x + trackBox.width - 16,
    trackBox.y + trackBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    trackBox.x + trackBox.width * 0.35,
    trackBox.y + trackBox.height / 2,
    { steps: 6 },
  );
  await page.waitForTimeout(200);
  await page.screenshot({
    path: out + '/desktop-previa-ativa.png',
    fullPage: true,
  });
  assert.ok(
    Math.abs(
      (await page.locator('.scene-bottom').boundingBox()).height -
        controlBox.height,
    ) < 1,
  );
  await page.mouse.up();
  await page.getByRole('slider').press('End');
  if (fs.existsSync('work/modular-live.json')) {
    const live = JSON.parse(fs.readFileSync('work/modular-live.json', 'utf8'));
    const actual = await (
      await fetch(base + '/api/projects?id=' + live.id)
    ).json();
    if (actual.params) {
      await page.reload();
      await page.getByLabel('Projeto atual').selectOption(actual.id);
      await page.waitForTimeout(800);
      await page.screenshot({
        path: out + '/desktop-aceite-glm.png',
        fullPage: true,
      });
      fs.writeFileSync(out + '/aceite-glm-pecas.csv', cutCSV(actual.params));
      fs.writeFileSync(
        out + '/aceite-glm-cortecloud.json',
        JSON.stringify(cortecloud(actual.params), null, 2),
      );
      fs.writeFileSync(
        out + '/aceite-glm-projeto.json',
        JSON.stringify(canonical(actual.params), null, 2),
      );
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + '/ui-results.json',
    JSON.stringify(
      {
        projectId: p.id,
        screenshots: fs.readdirSync(out).filter((x) => x.endsWith('.png')),
        errors,
        parts: p.parts.length,
        sharedPanels: p.parts.filter((x) => x.owners.length === 2).length,
        openingLimits: p.parts
          .filter((x) => x.motion)
          .map((x) => ({
            id: x.id,
            limit: openingLimit(p.parts, x.motion.id),
          })),
      },
      null,
      2,
    ),
  );
  console.log('PASS visual browser verification', out);
} finally {
  await browser.close();
}
