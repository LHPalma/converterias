// `test` com a página já aberta no app e, com COVERAGE=1, coletando a cobertura de código do navegador.
const base = require('@playwright/test');
const MCR = require('monocart-coverage-reports');
const { on, options } = require('./cobertura/config');

const APP = on ? 'cobertura.html' : 'index.html';

const test = base.test.extend({
  page: async ({ page }, use) => {
    if (on) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    if (on) await MCR(options).add(await page.coverage.stopJSCoverage());
  },
});

module.exports = { test, expect: base.expect, APP };
