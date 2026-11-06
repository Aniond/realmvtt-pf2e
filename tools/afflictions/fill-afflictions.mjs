#!/usr/bin/env node
// tools/afflictions/fill-afflictions.mjs
//
// Fills data.affliction on the records that deliver an affliction (poison
// items, weapons with a poison, spells, ability records, and NPCs' abilities
// in data.actions) and creates one stackable effect per affliction, in one
// campaign (a module's source campaign). Descriptions are never changed.
// The parser is ./parse.js; the ruleset reads data.affliction only.
//
//   node tools/afflictions/fill-afflictions.mjs
//       dry run: writes the report, changes nothing
//   ... --only "Curare"          one record (or NPC ability) by name
//   ... --write --limit 1        write one record, then stop
//   ... --write                  write the rest
//   ... --rollback tools/afflictions/backups/<file>.jsonl            dry run
//   ... --rollback tools/afflictions/backups/<file>.jsonl --write    undo
//
// The token and the campaign's invite code come from REALM_TOKEN and
// REALM_INVITE, or from tools/afflictions/config.json (gitignored):
//   { "token": "...", "inviteCode": "..." }
// REALM_API_URL overrides the backend (default https://utilities.realmvtt.com).
// Node 20+ (built-in fetch), no dependencies.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  getRecordAfflictions,
  isWritableAffliction,
  getAfflictionData,
  getAfflictionEffect,
  getAfflictionEffectName,
} = require("./parse.js");
const { getParsedReport, formatReport } = require("./report.js");

const configFile = path.join(here, "config.json");
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
const BASE = process.env.REALM_API_URL || config.baseUrl || "https://utilities.realmvtt.com";
const TOKEN = process.env.REALM_TOKEN || config.token;
const INVITE = process.env.REALM_INVITE || config.inviteCode;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const WRITE = flag("--write");
const LIMIT = option("--limit") ? parseInt(option("--limit"), 10) : Infinity;
const ONLY = option("--only");
const ROLLBACK = option("--rollback");

if (!TOKEN || (!INVITE && !ROLLBACK)) {
  console.error("Set REALM_TOKEN and REALM_INVITE, or write them to tools/afflictions/config.json.");
  process.exit(1);
}

// ------------------------------------------------------------------ HTTP

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).message || message;
    } catch {}
    throw new Error(`API ${res.status}: ${message} [${method} ${urlPath}]`);
  }
  const type = res.headers.get("content-type") || "";
  return type.includes("application/json") ? res.json() : {};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getCampaignId(inviteCode) {
  const res = await api("GET", `/campaigns?inviteCode=${encodeURIComponent(inviteCode)}`);
  if (!res.data?.length) throw new Error(`No campaign for invite code ${inviteCode}`);
  return res.data[0]._id;
}

// Every record of a query, a page at a time
async function* pages(endpoint, query) {
  let skip = 0;
  for (;;) {
    const params = new URLSearchParams({ ...query, $limit: "100", $skip: String(skip) });
    const res = await api("GET", `${endpoint}?${params}`);
    const rows = res.data || [];
    for (const row of rows) yield row;
    skip += rows.length;
    if (!rows.length || skip >= (res.total ?? skip)) return;
    await sleep(100);
  }
}

const endpointFor = (recordType) => (recordType === "npcs" ? "/npcs" : "/records");

// ------------------------------------------------------------------ Effects

// The affliction's effect, found by name in the campaign first so a second
// run creates nothing. Created only with --write (in the delivering record's
// category), and logged to the backup before the record that uses it is
// written. A dry run says what it would create.
async function ensureEffect(campaignId, affliction, { portrait, category }, backup) {
  const name = getAfflictionEffectName(affliction.name);
  const params = new URLSearchParams({ campaignId, name });
  const found = (await api("GET", `/effects?${params}`)).data?.[0];
  if (found) {
    if (!WRITE) console.log(`  uses effect ${name} (${found.category || "no category"})`);
    return found._id;
  }
  if (!WRITE) {
    console.log(`  would create effect ${name} (${category || "no category"})`);
    return null;
  }
  const effect = await api("POST", "/effects", getAfflictionEffect(affliction, { campaignId, portrait, category }));
  backup({ kind: "effect", _id: effect._id, name });
  console.log(`  created effect ${name}`);
  await sleep(150);
  return effect._id;
}

// ------------------------------------------------------------------ Rollback

// Restores each record's data and deletes the effects the run created,
// newest first
async function rollback(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line)).reverse();
  for (const entry of lines) {
    if (entry.kind === "record") {
      console.log(`restore ${entry.recordType} ${entry.name}`);
      if (WRITE) await api("PATCH", `${endpointFor(entry.recordType)}/${entry._id}`, { data: entry.data });
    } else if (entry.kind === "effect") {
      console.log(`delete effect ${entry.name || entry._id}`);
      if (WRITE) await api("DELETE", `/effects/${entry._id}`);
    }
    if (WRITE) await sleep(150);
  }
  if (!WRITE) console.log("Dry run: add --write to restore.");
}

// ------------------------------------------------------------------ Main

async function main() {
  if (ROLLBACK) return rollback(ROLLBACK);

  const campaignId = await getCampaignId(INVITE);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(here, "backups", `afflictions-${campaignId}-${stamp}.jsonl`);
  if (WRITE) fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  const backup = (entry) => WRITE && fs.appendFileSync(backupFile, `${JSON.stringify(entry)}\n`);

  // For the report: one row per affliction, an NPC's ability as its own
  const scanned = [];
  let written = 0;
  const sources = [
    ["/records", { campaignId, recordType: "items" }],
    ["/records", { campaignId, recordType: "actions" }],
    ["/records", { campaignId, recordType: "spells" }],
    ["/npcs", { campaignId }],
  ];

  for (const [endpoint, query] of sources) {
    for await (const listed of pages(endpoint, query)) {
      let found = getRecordAfflictions(listed);
      if (ONLY) found = found.filter((f) => f.name === ONLY || listed.name === ONLY);
      if (!found.length) continue;
      found.forEach((f) => {
        const where = f.index === null ? "" : ` (${listed.name})`;
        scanned.push({
          _id: listed._id,
          name: `${f.name}${where}`,
          recordType: f.index === null ? listed.recordType : "npc ability",
          category: listed.category,
          parsed: f,
        });
      });
      if (written >= LIMIT || !found.some(isWritableAffliction)) continue;

      // Read it fresh, and send the whole data object: a PATCH replaces data
      const fresh = await api("GET", `${endpointFor(listed.recordType)}/${listed._id}`);
      const freshFound = getRecordAfflictions(fresh).filter((f) => !ONLY || f.name === ONLY || fresh.name === ONLY);
      const writable = freshFound.filter(isWritableAffliction);
      // Already written (with its effect): nothing to do, so a second run
      // changes nothing
      const storedIds = {};
      writable.forEach((f) => {
        const stored = f.index === null ? fresh.data?.affliction : fresh.data?.actions?.[f.index]?.data?.affliction;
        if (stored?.effectId) storedIds[getAfflictionEffectName(f.affliction.name)] = stored.effectId;
      });
      if (Object.keys(storedIds).length === writable.length && !getAfflictionData(fresh, freshFound, storedIds)) continue;

      if (!WRITE) {
        console.log(`would write ${fresh.name}`);
        for (const f of writable) await ensureEffect(campaignId, f.affliction, { category: fresh.category }, backup);
        written += 1;
        continue;
      }
      // The record's data before the change, then any effect it creates
      backup({ kind: "record", recordType: fresh.recordType, _id: fresh._id, name: fresh.name, data: fresh.data });
      const effectIds = {};
      for (const f of writable) {
        effectIds[getAfflictionEffectName(f.affliction.name)] = await ensureEffect(campaignId, f.affliction, { portrait: fresh.portrait || "", category: fresh.category || "" }, backup);
      }
      const next = getAfflictionData(fresh, freshFound, effectIds);
      if (!next) continue;
      await api("PATCH", `${endpointFor(fresh.recordType)}/${fresh._id}`, { data: next });
      written += 1;
      console.log(`wrote ${fresh.name}`);
      await sleep(150);
    }
  }

  // The report to check against the books
  const report = getParsedReport(scanned.map((row) => ({ record: row, affliction: row.parsed.affliction, problems: row.parsed.problems })));
  const reportFile = path.join(here, `afflictions-report-${campaignId}.md`);
  fs.writeFileSync(reportFile, formatReport(report));
  const notWritten = scanned.filter((row) => !isWritableAffliction(row.parsed));
  console.log(`${scanned.length} afflictions, ${scanned.length - notWritten.length} writable, ${notWritten.length} to fix by hand`);
  notWritten.forEach((row) => console.log(`  ${row.recordType} ${row.name} (${row.category || "?"}): ${row.parsed.problems.join("; ")}`));
  console.log(`Report: ${reportFile}`);
  if (WRITE && written) console.log(`Wrote ${written}. Backup: ${backupFile} (undo with --rollback ${backupFile} --write)`);
  else if (WRITE) console.log("Wrote 0: everything already matches.");
  else console.log(`Dry run: ${written} would be written. Add --write --limit 1 to write one.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
