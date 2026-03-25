#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';

if (process.env.npm_config_global !== 'true') {
  process.exit(0);
}

const SHELL_FUNCTION = `
# clily: start server or open file in clily editor panel
clily() {
  if [ $# -eq 0 ]; then
    command clily
  else
    printf '\\e]9001;%s\\007' "$(realpath "$1" 2>/dev/null || echo "$1")"
  fi
}
`;

const MARKER = '# clily: open file in clily editor panel';

const rcFiles = [
  path.join(os.homedir(), '.zshrc'),
  path.join(os.homedir(), '.bashrc'),
];

for (const rcFile of rcFiles) {
  if (!fs.existsSync(rcFile)) continue;

  const content = fs.readFileSync(rcFile, 'utf8');
  if (content.includes(MARKER)) continue;

  fs.appendFileSync(rcFile, SHELL_FUNCTION);
  console.log(`clily: shell function added to ${rcFile}`);
}

console.log('clily: shell setup complete. Restart your terminal or run: source ~/.zshrc');
