#!/usr/bin/env node
// The parse report: every record with "Stage N" lines, read as the data
// script would write data.affliction, for checking against the books.
// Reads nothing from Realm and writes nothing.
//
// Usage: node tools/afflictions/report.js records.json [--json out.json]
//   records.json: an array of records (or { records: [...] }), as Realm
//   returns them, with name, recordType, category and data.

const fs = require("fs");
const { parseRecordAffliction, describeAffliction } = require("./parse");

function getReport(records) {
  return getParsedReport(
    records
      .filter((r) => /Stage \d+/i.test(r?.data?.description || ""))
      .map((record) => ({ record, ...parseRecordAffliction(record) })),
  );
}

// The same from rows already parsed: { record, affliction, problems }
function getParsedReport(parsed) {
  const rows = parsed.map(({ record, affliction, problems }) => ({
    record,
    affliction,
    problems,
    status: !affliction ? "not parsed" : problems.length ? "partial" : "clean",
  }));
  const bySource = {};
  rows.forEach(({ record, status }) => {
    const source = record.category || "(no category)";
    bySource[source] = bySource[source] || { clean: 0, partial: 0, "not parsed": 0 };
    bySource[source][status] += 1;
  });
  return { rows, bySource };
}

function formatReport({ rows, bySource }) {
  const count = (status) => rows.filter((r) => r.status === status).length;
  const lines = [
    `# Afflictions: ${rows.length} records, ${count("clean")} clean, ${count("partial")} partial, ${count("not parsed")} not parsed`,
    "",
    "| Source | Clean | Partial | Not parsed |",
    "| --- | --- | --- | --- |",
    ...Object.entries(bySource)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, c]) => `| ${source} | ${c.clean} | ${c.partial} | ${c["not parsed"]} |`),
  ];
  ["not parsed", "partial", "clean"].forEach((status) => {
    const group = rows.filter((r) => r.status === status);
    if (!group.length) return;
    lines.push("", `## ${status[0].toUpperCase()}${status.slice(1)} (${group.length})`);
    group
      .sort((a, b) => `${a.record.category}${a.record.name}`.localeCompare(`${b.record.category}${b.record.name}`))
      .forEach(({ record, affliction, problems }) => {
        lines.push("", `### ${record.name} (${record.recordType}, ${record.category || "no category"}${record._id ? `, ${record._id}` : ""})`);
        if (problems.length) lines.push(`Problems: ${problems.join("; ")}`);
        if (affliction) lines.push("```", describeAffliction(affliction), "```");
      });
  });
  return lines.join("\n");
}

if (require.main === module) {
  const [file, flag, out] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: node tools/afflictions/report.js records.json [--json out.json]");
    process.exit(1);
  }
  const input = JSON.parse(fs.readFileSync(file, "utf8"));
  const report = getReport(Array.isArray(input) ? input : input.records || []);
  console.log(formatReport(report));
  if (flag === "--json" && out) {
    fs.writeFileSync(out, JSON.stringify(report.rows.map(({ record, affliction, problems, status }) => ({ _id: record._id, name: record.name, category: record.category, status, problems, affliction })), null, 2));
  }
}

module.exports = { getReport, getParsedReport, formatReport };
