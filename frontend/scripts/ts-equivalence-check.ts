// Proves a JS→TS conversion added types only: strips types from each .ts/.tsx file and compares
// the result with the original .js/.jsx/.mjs from git HEAD (both normalised the same way).
// Usage (from backend/ or frontend/):
//   npx tsx scripts/ts-equivalence-check.ts src/services/Foo.ts [more.ts ...]
//   npx tsx scripts/ts-equivalence-check.ts --list <file-with-paths>
//   --vs-head  compare with the same path's committed version (file already .ts in HEAD)
import ts from 'typescript';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const vsHead = argv.includes('--vs-head');
const args = argv.filter(a => a !== '--vs-head');
const files: string[] = args[0] === '--list'
  ? fs.readFileSync(args[1] ?? '', 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  : args;

// "backend/" or "frontend/": paths in git HEAD are relative to the repo root.
const prefix = execSync('git rev-parse --show-prefix', { encoding: 'utf8' }).trim();

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  removeComments: true,
  verbatimModuleSyntax: true,
  jsx: ts.JsxEmit.Preserve,
};

function norm(code: string, name: string): string {
  const js = ts.transpileModule(code, { compilerOptions, fileName: name }).outputText;
  const sf = ts.createSourceFile('x.jsx', js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JSX);
  return ts.createPrinter({ removeComments: true }).printFile(sf)
    .replace(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g, '$1 =>') // (x) => vs x =>
    .replace(/\(\s*/g, '(').replace(/\s*\)/g, ')')
    .replace(/\(\(([^()]*)\)\)/g, '($1)')                // ((expr)) left over from `as` casts
    .replace(/\s+/g, ' ');
}

function gitShow(path: string): string | undefined {
  try {
    return execSync(`git show "HEAD:${prefix}${path}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

let same = 0;
const diffs: string[] = [];
for (const f of files) {
  const isX = f.endsWith('x');
  const candidates = vsHead
    ? [f]
    : [f.replace(/\.tsx$/, '.jsx').replace(/\.ts$/, '.js'), f.replace(/\.ts$/, '.mjs')];
  let oldSrc: string | undefined;
  let oldName = '';
  for (const c of candidates) {
    oldSrc = gitShow(c);
    if (oldSrc !== undefined) { oldName = c; break; }
  }
  if (oldSrc === undefined) { diffs.push(`${f}: no original ${candidates[0]} in HEAD (new file?)`); continue; }
  const a = norm(oldSrc, vsHead ? (isX ? 'a.tsx' : 'a.ts') : (oldName.endsWith('x') ? 'a.jsx' : 'a.js'));
  const b = norm(fs.readFileSync(f, 'utf8'), isX ? 'b.tsx' : 'b.ts');
  if (a === b) { same++; continue; }
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  diffs.push(`${f}\n   old: …${a.slice(Math.max(0, i - 70), i + 90)}\n   new: …${b.slice(Math.max(0, i - 70), i + 90)}`);
}
console.log(`${same}/${files.length} files identical at runtime`);
for (const d of diffs) console.log('DIFF ' + d);
process.exit(diffs.length ? 1 : 0);
