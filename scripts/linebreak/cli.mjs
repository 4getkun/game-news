#!/usr/bin/env node
// Japanese line breaking for a static build: every .html under a folder, in place.
//
//   node cli.mjs [dir=dist] [--config linebreak.config.mjs] [--check] [--dry-run] [--quiet]
//
//   --config   a module exporting the config object, or a function (dir) => config (may be
//              async; e.g. to read proper nouns from the built data). Default:
//              ./linebreak.config.mjs when it exists, else the built-in defaults.
//   --check    change nothing; exit 1 if any page would change (CI: "was the build run?")
//   --dry-run  change nothing; report what would be done
//   --quiet    no summary line
//
//   node cli.mjs --vendor <dir>   copy this package's files into a project (no git dependency,
//                                 so its CI needs no access to this private repository)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import { createRules, processDocument } from "./core.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (opt("--vendor")) {
  const to = resolve(opt("--vendor")), from = dirname(fileURLToPath(import.meta.url));
  mkdirSync(to, { recursive: true });
  for (const f of ["core.mjs", "cli.mjs", "linebreak.css", "linebreak.js", "README.md"]) copyFileSync(join(from, f), join(to, f));
  if (!existsSync("linebreak.config.mjs")) copyFileSync(join(from, "linebreak.config.example.mjs"), "linebreak.config.mjs");
  console.log(`linebreak: copied to ${to}. Next: npm i -D budoux linkedom; run "node ${join(opt("--vendor"), "cli.mjs")} dist" after the build; load linebreak.css and inline linebreak.js (README.md).`);
  process.exit(0);
}
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--config" && args[i - 1] !== "--vendor") ?? "dist";
const check = flag("--check"), dry = flag("--dry-run") || check, quiet = flag("--quiet");

const configPath = opt("--config") ?? (existsSync("linebreak.config.mjs") ? "linebreak.config.mjs" : null);
let config = {};
if (configPath) {
  const mod = await import(pathToFileURL(resolve(configPath)).href);
  config = typeof mod.default === "function" ? await mod.default(dir) : mod.default ?? {};
}
const rules = createRules(config);

function* htmlFiles(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}

const JA = /[぀-ヿ㐀-鿿]/;
let files = 0, pages = 0, elements = 0, joined = 0;
const changedFiles = [];
for (const file of htmlFiles(dir)) {
  pages++;
  const html = readFileSync(file, "utf-8");
  if (!JA.test(html)) continue; // nothing Japanese: not worth parsing
  const { document } = parseHTML(html);
  const s = processDocument(document, rules);
  if (!s.changed) continue;
  files++; elements += s.elements; joined += s.joined;
  changedFiles.push(file);
  if (!dry) {
    const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0].trim() ?? "<!DOCTYPE html>";
    writeFileSync(file, doctype + document.documentElement.outerHTML);
  }
}
if (!quiet) {
  const verb = dry ? "would change" : "changed";
  console.log(`linebreak: ${verb} ${files} of ${pages} pages, ${elements} elements, ${joined} line breaks between Japanese text removed`);
}
if (check && files) {
  console.error(`linebreak: ${files} pages are not processed yet, e.g. ${changedFiles.slice(0, 3).join(", ")}`);
  process.exit(1);
}
