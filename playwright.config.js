// Testes de regressão: abrem o index.html de verdade no Chromium (servido por HTTP, como no GitHub Pages)
// e passam arquivos gerados na hora por cada conversor. Rode com: npm test
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    acceptDownloads: true,
    serviceWorkers: 'block',   // o cache do app não pode mascarar um index.html novo
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stderr: 'ignore',   // o http.server do Python loga cada requisição
  },
});
