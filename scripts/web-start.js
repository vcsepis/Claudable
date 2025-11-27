#!/usr/bin/env node

/**
 * Cross-platform launcher for the web app with lighter defaults.
 * - Sets SKIP_DB_SYNC=1 unless already provided.
 * - Sets NODE_ENV=production unless already provided.
 * - Forwards CLI args to scripts/run-web.js (including --port).
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const isWindows = os.platform() === 'win32';
const args = process.argv.slice(2);

const env = {
  ...process.env,
  SKIP_DB_SYNC: process.env.SKIP_DB_SYNC || '1',
  NODE_ENV: process.env.NODE_ENV || 'production',
};

const child = spawn(
  'node',
  [path.join(__dirname, 'run-web.js'), ...args],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: isWindows,
    env,
  }
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('[web-start] Failed to launch web server:', error);
  process.exit(1);
});
