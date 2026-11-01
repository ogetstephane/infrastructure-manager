import { spawn } from 'node-pty';

const BIN = process.env.COPILOT_BIN || 'copilot';

export const preApprovals = (v = process.env.FACTORY_COPILOT_ALLOW) => String(v ?? '').split(';').map((s) => s.trim()).flatMap((e) => {
  const m = /^(tool|url):(\S.*)$/.exec(e);
  return m ? [`--allow-${m[1]}=${m[2]}`] : [];
});

export function startCopilot(prompt, cwd, { allowAllTools = true } = {}) {
  return spawn(BIN, [
    '-i',
    prompt,
    ...(allowAllTools ? ['--allow-all-tools', '--allow-all-paths', ...preApprovals()] : []),
    '--no-auto-update',
  ], {
    cwd,
    cols: 100,
    rows: 30,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
}
