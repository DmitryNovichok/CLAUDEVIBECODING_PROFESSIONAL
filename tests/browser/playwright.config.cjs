const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '.', testMatch: '**/*.spec.cjs', timeout: 120000,
  expect: { timeout: 10000 }, workers: 2,
  forbidOnly: !!process.env.CI,
  use: {
    headless: true, launchOptions: { chromiumSandbox: true },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  outputDir: 'test-results',
  reporter: [['list'], ['json',{outputFile:'results.json'}], ['html',{outputFolder:'playwright-report',open:'never'}]],
});
