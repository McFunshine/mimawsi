import { defineConfig } from 'astro/config';

// Static output, zero client JavaScript by default. Both are load-bearing:
// static is why hosting costs nothing (RULE-48's read path has no compute), and
// zero-JS is what keeps the catalogue browsable with scripting off (RULE-33).
export default defineConfig({
  output: 'static',
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
