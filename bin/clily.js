#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const port = process.env.PORT || 3000;

const child = spawn('node', [path.join(root, 'node_modules/.bin/next'), 'start', '--port', port], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('error', (err) => {
  console.error('clily: failed to start server:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
