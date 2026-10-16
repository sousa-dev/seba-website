#!/usr/bin/env node
// Privacy guard for a PUBLIC website. Fails (exit 1) if publishable content contains
// private data: contact details, secrets, internal paths, or anything that names a
// Sousa Dev client or employee.
//
// Two layers:
//  1. Generic patterns (always on, also in CI).
//  2. A private denylist built at runtime from the agent's workspace
//     (clients/*/profile.md, employees/*/profile.md, website-denylist.txt).
//     It only exists on the agent's machine, so the names never enter this public repo.
//
// Usage: node scripts/privacy-check.mjs [--text "<commit message or other text>"]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { homedir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const WORKSPACE = process.env.SEBA_WORKSPACE || join(homedir(), '.openclaw', 'workspace');

const SCAN_DIRS = ['src', 'public'];
const SCAN_FILES = ['astro.config.mjs', 'README.md'];
const TEXT_EXT = new Set(['.md', '.mdx', '.astro', '.html', '.js', '.mjs', '.ts', '.css', '.json', '.txt', '.xml', '.svg', '.yml', '.yaml', '']);

// Public, allowed contact points: info@ (on sousadev.com), S.E.B.A's own inbox (approved by
// Henrique 2026-10-16) + commit-trailer noreply addresses.
const ALLOWED_EMAILS = new Set(['info@sousadev.com', 'seba-sousadev@agentmail.to', 'noreply@anthropic.com']);
// Private-record terms that are public anyway: Henrique's name, as on sousadev.com (approved by
// Henrique 2026-10-16). His email/phone from the profile stay blocked.
const ALLOWED_TERMS = new Set(['henrique sousa']);
const isAllowedEmail = (e) => ALLOWED_EMAILS.has(e.toLowerCase()) || /@users\.noreply\.github\.com$/i.test(e);

const GENERIC = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'email address', (m) => !isAllowedEmail(m)],
  [/(?:\+|00)\s?\d[\d\s().-]{7,}\d/g, 'phone number'],
  [/\b9[1236]\d[\s.-]?\d{3}[\s.-]?\d{3}\b/g, 'PT mobile number'],
  [/\b(?:NIF|NIPC|VAT|contribuinte)\b[^\n]{0,20}\d{9}/gi, 'tax number'],
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){4,7}\b/g, 'IBAN'],
  [/sk-ant-[A-Za-z0-9]|xox[abpe]-|xapp-\d|gh[opsu]_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE|AIza[0-9A-Za-z_-]{30}/g, 'secret/token'],
  [/\bU0[A-Z0-9]{8,}\b/g, 'Slack user ID'],
  [/\/home\/agent|\.openclaw|sysadmin\//g, 'internal server path'],
  [/\b(?:clients|employees)\/[a-z0-9-]+/g, 'reference to private workspace records'],
  [/\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/g, 'private IP address'],
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT_EXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function denylist() {
  const terms = new Set();
  const add = (t) => {
    t = (t || '').trim().replace(/^<.*>$/, '');
    if (t && t !== '—' && t !== '-' && t.length >= 4 && !ALLOWED_TERMS.has(t.toLowerCase())) terms.add(t.toLowerCase());
  };
  for (const kind of ['clients', 'employees']) {
    const base = join(WORKSPACE, kind);
    if (!existsSync(base)) continue;
    for (const slug of readdirSync(base)) {
      if (slug.startsWith('_') || slug.startsWith('.')) continue;
      const dir = join(base, slug);
      if (!statSync(dir).isDirectory()) continue;
      add(slug.replace(/-/g, ' '));
      const profile = join(dir, 'profile.md');
      if (!existsSync(profile)) continue;
      const text = readFileSync(profile, 'utf8');
      add(text.match(/^#\s+(.+)$/m)?.[1]);
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) add(m[0]);
      for (const m of text.matchAll(/\+?\d[\d\s]{7,}\d/g)) add(m[0]);
      for (const m of text.matchAll(/https?:\/\/([^\s/|)]+)/g)) add(m[1].replace(/^www\./, ''));
      for (const m of text.matchAll(/\b([a-z0-9-]+\.(?:com|pt|net|org|io|dev|app|eu))\b/gi)) {
        if (!/sousadev\.com$/i.test(m[1])) add(m[1].replace(/^www\./, ''));
      }
      // Contacts table: first cell of each row under "## Contacts"
      const contacts = text.split(/^## Contacts/m)[1]?.split(/^## /m)[0] || '';
      for (const row of contacts.split('\n').slice(3)) add(row.split('|')[1]);
      for (const m of text.matchAll(/^\|\s*(?:GitHub|Slack|Website)\s*\|\s*([^|]+)\|/gim)) add(m[1]);
    }
  }
  const extra = join(WORKSPACE, 'website-denylist.txt');
  if (existsSync(extra)) {
    for (const l of readFileSync(extra, 'utf8').split('\n')) if (!l.startsWith('#')) add(l);
  }
  return [...terms];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scan(label, text, terms) {
  const hits = [];
  for (const [re, what, keep = () => true] of GENERIC) {
    for (const m of text.matchAll(re)) if (keep(m[0])) hits.push(`${label}: ${what}: "${m[0].slice(0, 60)}"`);
  }
  const lower = text.toLowerCase();
  for (const t of terms) {
    if (new RegExp(`(^|[^a-z0-9])${escape(t)}([^a-z0-9]|$)`).test(lower)) {
      hits.push(`${label}: matches a private client/employee record (term hidden)`);
    }
  }
  return hits;
}

const terms = denylist();
const files = [...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))), ...SCAN_FILES.map((f) => join(ROOT, f)).filter(existsSync)];
let hits = files.flatMap((f) => scan(relative(ROOT, f), readFileSync(f, 'utf8'), terms));
const textArg = process.argv.indexOf('--text');
if (textArg > -1) hits = hits.concat(scan('commit message', process.argv[textArg + 1] || '', terms));

const mode = existsSync(join(WORKSPACE, 'clients')) ? `generic + ${terms.length} private terms` : 'generic only (no workspace found)';
if (hits.length) {
  console.error(`✗ PRIVACY CHECK FAILED (${mode}). Nothing may be published until these are removed:`);
  for (const h of [...new Set(hits)]) console.error('  - ' + h);
  console.error('This site is public. No client or employee information, ever. See the seba-website skill.');
  process.exit(1);
}
console.log(`✓ privacy check passed (${files.length} files, ${mode})`);
