// Loads content.js into test pages with a fake chrome.runtime and checks
// detection, the Paste chip, auto-fill and split boxes.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const script = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const fake = (autoFill) => `
  window.chrome = { runtime: { sendMessage: async (m) => {
    (window.__msgs ||= []).push(m);
    if (m.type === 'check') return { status: 'found', id: 'm1', code: '482913', from: 'Google', settings: { autoFill: ${autoFill} } };
    return { ok: true };
  } } };`;

const browser = await chromium.launch();
async function page(html, autoFill = false) {
  const p = await browser.newPage();
  await p.setContent(`<!doctype html><body>${html}</body>`);
  await p.addScriptTag({ content: fake(autoFill) });
  await p.addScriptTag({ content: script });
  return p;
}
let n = 0;

// 1. one-time-code field → chip → Paste fills it
{
  const p = await page('<label>Verification code <input id="c" autocomplete="one-time-code"></label>');
  await p.waitForSelector('codecatch-chip', { state: 'attached' });
  const box = await p.locator('codecatch-chip').boundingBox();
  await p.mouse.click(box.x + 40, box.y + box.height / 2);
  assert.equal(await p.inputValue('#c'), '482913'); n++;
  await p.close();
}
// 2. auto-fill on
{
  const p = await page('<input name="otp" inputmode="numeric" maxlength="6" id="c">', true);
  await p.waitForFunction(() => document.getElementById('c').value === '482913'); n++;
  await p.close();
}
// 3. six split boxes
{
  const boxes = Array.from({ length: 6 }, () => '<input maxlength="1" inputmode="numeric">').join('');
  const p = await page(`<div class="otp">${boxes}</div>`, true);
  await p.waitForFunction(() => [...document.querySelectorAll('input')].map((i) => i.value).join('') === '482913'); n++;
  await p.close();
}
// 4. unrelated fields are ignored
{
  const p = await page('<input name="email"><input name="zip_code" maxlength="5" inputmode="numeric"><input type="password" name="password">');
  await p.waitForTimeout(800);
  const msgs = await p.evaluate(() => window.__msgs || []);
  assert.equal(msgs.length, 0, 'should not poll Gmail on a normal login form'); n++;
  await p.close();
}
await browser.close();
console.log(`${n} content tests passed`);
