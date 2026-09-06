// Cuts a saved 1.4 MB TDX page down to just the ticket form, so tests have real markup to work with.
//
// Run once; the output is checked in so tests never depend on a local download.
//   node scripts/make-fixture.ts "<path to saved New.html>" test/fixtures/tdx-form-162.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: make-fixture.ts <input.html> <output.html>');
  process.exit(1);
}

let html = readFileSync(input, 'utf8');

// Scripts are ~95% of the bytes and none of the signal. The resolver reads
// markup attributes only, so stripping them keeps the fixture honest.
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
html = html.replace(/<link\b[^>]*>/gi, '');

const start = html.search(/<form\b/i);
const end = html.toLowerCase().lastIndexOf('</form>');
if (start === -1 || end === -1) {
  console.error('no <form> found in input');
  process.exit(1);
}
let form = html.slice(start, end + '</form>'.length);

// The anti-forgery token is a real session credential. It must not be committed.
form = form.replace(
  /(name="__RequestVerificationToken"[^>]*value=")[^"]*(")/gi,
  '$1REDACTED$2'
);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `<!doctype html>\n<html><head><meta charset="utf-8"><title>TDX fixture form 162</title></head>\n<body>\n${form}\n</body></html>\n`
);
console.log(`wrote ${output} (${form.length} bytes of form markup)`);
