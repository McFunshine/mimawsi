/**
 * Starts the three phase-0 processes together and shuts them down together.
 *
 *   catalogue  :4321  Astro       — pages and downloads
 *   runner     :4322  static      — where tools execute, a separate origin on purpose
 *   api        :4323  Lambdas     — submit and session
 *
 * Each becomes something else later (CloudFront, a second distribution, Function
 * URLs). Three processes now because there are three origins then.
 */
import { spawn } from 'node:child_process';

const SERVICES = [
  { name: 'catalogue', colour: '\x1b[35m', script: 'dev:site' },
  { name: 'runner   ', colour: '\x1b[36m', script: 'dev:runner' },
  { name: 'api      ', colour: '\x1b[33m', script: 'dev:api' },
];
const RESET = '\x1b[0m';

const children = SERVICES.map(({ name, colour, script }) => {
  const child = spawn('npm', ['run', '--silent', script], { stdio: ['ignore', 'pipe', 'pipe'] });

  const prefix = (line) => `${colour}${name}${RESET} │ ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        // Node's type-stripping warning is noise on every start.
        if (line.trim() !== '' && !line.includes('ExperimentalWarning') && !line.includes('trace-warnings')) {
          process.stdout.write(`${prefix(line)}\n`);
        }
      }
    });
  }

  return child;
});

const stop = () => {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(0);
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

setTimeout(() => {
  process.stdout.write('\n  \x1b[1mmimawsi\x1b[0m is up → \x1b[4mhttp://localhost:4321\x1b[0m\n');
  process.stdout.write('  share a tool → http://localhost:4321/share\n');
  process.stdout.write('  approve it   → npm run review -- approve --latest\n\n');
}, 2500);
