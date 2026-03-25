/**
 * Test: validatie teamnamen bij nieuwe wedstrijd
 * Run: node test-team-validation.js
 * Vereist: Node.js + npm install playwright
 */
const { chromium } = require('playwright');

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const baseUrl = 'http://localhost:8080/volleyball-scout/';

  console.log('=== Test: teamnaam-validatie ===\n');

  // Test 1: Beide velden leeg
  await page.goto(baseUrl);
  await page.fill('#teamA', '');
  await page.fill('#teamB', '');
  let dialogShown = false;
  page.once('dialog', async (d) => { dialogShown = true; await d.accept(); });
  await page.click('button[data-next="step-players"]');
  await page.waitForTimeout(400);
  console.log('Test 1 (beide leeg):     ', dialogShown ? 'PASS - alert getoond, niet doorgestuurd' : 'FAIL - kon doorklikken zonder alert');

  // Test 2: Alleen thuis ingevuld
  await page.goto(baseUrl);
  await page.fill('#teamA', 'Thuisploeg');
  await page.fill('#teamB', '');
  dialogShown = false;
  page.once('dialog', async (d) => { dialogShown = true; await d.accept(); });
  await page.click('button[data-next="step-players"]');
  await page.waitForTimeout(400);
  console.log('Test 2 (alleen thuis):  ', dialogShown ? 'PASS - alert getoond' : 'FAIL - kon doorklikken');

  // Test 3: Alleen uit ingevuld
  await page.goto(baseUrl);
  await page.fill('#teamA', '');
  await page.fill('#teamB', 'Uitploeg');
  dialogShown = false;
  page.once('dialog', async (d) => { dialogShown = true; await d.accept(); });
  await page.click('button[data-next="step-players"]');
  await page.waitForTimeout(400);
  console.log('Test 3 (alleen uit):    ', dialogShown ? 'PASS - alert getoond' : 'FAIL - kon doorklikken');

  // Test 4: Beide ingevuld – mag doorklikken
  await page.goto(baseUrl);
  await page.fill('#teamA', 'Thuis');
  await page.fill('#teamB', 'Uit');
  await page.click('button[data-next="step-players"]');
  await page.waitForTimeout(400);
  const onPlayersStep = !(await page.$eval('#step-players', (el) => el.classList.contains('hidden')));
  console.log('Test 4 (beide ingevuld): ', onPlayersStep ? 'PASS - doorgestuurd naar spelers' : 'FAIL');

  await browser.close();
  console.log('\n=== Klaar ===');
}

runTests().catch((err) => {
  console.error('Fout:', err.message);
  process.exit(1);
});
