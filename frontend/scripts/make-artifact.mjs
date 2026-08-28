// Packages the demo build (dist-demo/) into a single self-contained HTML
// fragment suitable for publishing as a claude.ai Artifact: inlines the JS
// bundle and CSS, keeps the Google Fonts links and the theme-init script.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-demo');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');

const scriptMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
const cssMatch = html.match(/<link[^>]*rel="stylesheet"[^>]*href="(\/assets\/[^"]+)"[^>]*>/);
if (!scriptMatch || !cssMatch) {
  throw new Error('Could not locate bundle references in dist-demo/index.html');
}

const js = readFileSync(path.join(dist, scriptMatch[1].replace(/^\//, '')), 'utf8');
const css = readFileSync(path.join(dist, cssMatch[1].replace(/^\//, '')), 'utf8');

// Keep an inline </script> inside the bundle from terminating our script tag.
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const themeScript = (html.match(/<script>([\s\S]*?)<\/script>/) ?? [])[1] ?? '';

const out = `<title>Korzah CRM</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<script>${themeScript}</script>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${safeJs}
</script>
`;

const target = path.join(dist, 'artifact.html');
writeFileSync(target, out);
console.log(`Wrote ${target} (${(out.length / 1024).toFixed(0)} KB)`);
