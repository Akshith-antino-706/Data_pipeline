// Proves a JS→TS conversion added types only: strips types from each .ts file and compares
// the result with the original .js from git HEAD (both normalised through the same printer).
// Usage (from backend/):  node scripts/ts-equivalence-check.cjs src/services/Foo.ts [more.ts ...]
//                    or:  node scripts/ts-equivalence-check.cjs --list <file-with-paths>
const ts = require('typescript');
const fs = require('fs');
const { execSync } = require('child_process');

// --vs-head: compare against the same path's committed version (for files that are already
// .ts in HEAD and are only getting more types), instead of the original .js.
const argv = process.argv.slice(2);
const vsHead = argv.includes('--vs-head');
const args = argv.filter(a => a !== '--vs-head');
const files = args[0] === '--list'
  ? fs.readFileSync(args[1], 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  : args;

const co = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true, verbatimModuleSyntax: true };
function norm(code, name) {
  const js = ts.transpileModule(code, { compilerOptions: co, fileName: name }).outputText;
  const sf = ts.createSourceFile('x.js', js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  return ts.createPrinter({ removeComments: true }).printFile(sf)
    .replace(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g, '$1 =>') // (x) => vs x =>
    .replace(/\(\s*/g, '(').replace(/\s*\)/g, ')')
    .replace(/\(\(([^()]*)\)\)/g, '($1)')                // ((expr)) left over from `as` casts
    .replace(/\s+/g, ' ');
}

let same = 0;
const diffs = [];
for (const f of files) {
  const oldPath = vsHead ? f : f.replace(/\.ts$/, '.js');
  let oldSrc;
  try { oldSrc = execSync(`git show HEAD:backend/${oldPath}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { diffs.push(`${f}: no original ${oldPath} in HEAD (new file?)`); continue; }
  const a = norm(oldSrc, vsHead ? 'a.ts' : 'a.js');
  const b = norm(fs.readFileSync(f, 'utf8'), 'b.ts');
  if (a === b) { same++; continue; }
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  diffs.push(`${f}\n   old: …${a.slice(Math.max(0, i - 70), i + 90)}\n   new: …${b.slice(Math.max(0, i - 70), i + 90)}`);
}
console.log(`${same}/${files.length} files identical at runtime`);
for (const d of diffs) console.log('DIFF ' + d);
process.exit(diffs.length ? 1 : 0);
