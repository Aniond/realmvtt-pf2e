// Tests for the spell pickers (rollhandlers/spell-pickers.js): the empty rows
// of the managed spellcasting entries, the prompts that fill them at Level Up
// and in the creation wizard, the Divine Font's heal or harm, and the row and
// query the spell list shares with them.
// Run: node tests/test-spell-pickers.js (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

const classRecord = (name) => ({
  _id: `class-${name}`,
  name,
  recordType: "class",
  data: { publication: { remaster: true, title: "Pathfinder Player Core" }, features: [] },
});
const character = (className, level, data = {}) => ({
  _id: "pc",
  name: "Ezren",
  recordType: "characters",
  data: { level, classes: [classRecord(className)], spellcasting: "1", int: 4, wis: 4, cha: 4, autoSpellcasting: true, ...data },
  fields: {},
});
// Writes a valuesToSet payload into a copy of the record, as Realm does
function apply(record, values) {
  const next = JSON.parse(JSON.stringify(record));
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    let target = next;
    for (const part of parts.slice(0, -1)) {
      if (target[part] === undefined || target[part] === null) target[part] = {};
      target = target[part];
    }
    target[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
  }
  return next;
}
// The spellcasting part of one onAddEditFeature run
function synced(record) {
  const values = {};
  const entries = ctx.syncSpellcastingEntries(record, values);
  ctx.updateSpellcastingEntries(record, values, entries);
  return apply(record, values);
}
// A sorcerer whose tradition is set (the bloodline's choice)
const sorcerer = (level = 1) => {
  const record = synced(character("Sorcerer", level));
  record.data.spells[0].data.tradition = "Arcane";
  return record;
};
const spell = (name, level = 1, traits = []) => ({
  _id: `spell-${name}`,
  name,
  recordType: "spells",
  data: { type: "spell", level, traits: ["Arcane", ...traits], traditions: ["arcane"], defense: { save: { statistic: "reflex", basic: true } } },
  fields: { spellBox: { hidden: false } },
});
const emptyCount = (entry, list) => (entry.data[list] || []).filter((row) => row.data?.type === "slot").length;

// Runs promptSpellPicks against a record held here: getRecord reads it,
// setValues writes into it, and answer(prompt) picks for each prompt
function runPicks(record, answer, fontSpells = []) {
  const state = { record, prompts: [], writes: 0, nextCalls: 0 };
  const saved = { ...ctx.api };
  ctx.api.getRecord = (type, id, cb) => cb(JSON.parse(JSON.stringify(state.record)));
  ctx.api.setValues = (values, cb) => {
    state.writes++;
    state.record = apply(state.record, values);
    if (cb) cb(state.record);
  };
  ctx.api.getRecordsByQuery = (type, query, cb) =>
    cb(fontSpells.filter((s) => (query.name?.$in || []).includes(s.name)));
  ctx.api.showPrompt = (title, text, placeholder, options, query, cb, ok, skip, count) => {
    const prompt = { title, text, options, query, count };
    state.prompts.push(prompt);
    cb(answer(prompt));
  };
  try {
    ctx.promptSpellPicks(record._id, () => state.nextCalls++);
  } finally {
    Object.assign(ctx.api, saved);
  }
  return state;
}

section("The empty rows");
{
  const record = sorcerer();
  const entry = record.data.spells[0];
  const groups = ctx.getOpenSpellRowGroups(record);
  assert("a group per rank with empty rows", groups.map((g) => g.list), ["cantrips", "spells1"]);
  assert("cantrips: every empty row", groups[0].rowIndexes.length, emptyCount(entry, "cantrips"));
  assert("1st rank: every empty row", groups[1].rowIndexes.length, emptyCount(entry, "spells1"));
  assert("the entry's type and tradition", [groups[1].entryType, groups[1].tradition, groups[1].rank], ["spontaneous", "Arcane", 1]);

  const noTradition = synced(character("Sorcerer", 1));
  assert("no tradition yet (no bloodline): nothing to pick", ctx.getOpenSpellRowGroups(noTradition), []);

  const off = sorcerer();
  off.data.spells[0].data.autoSlots = false;
  assert("slots turned off: left alone", ctx.getOpenSpellRowGroups(off), []);
  const orphaned = sorcerer();
  orphaned.data.spells[0].data.auto.orphaned = true;
  assert("the class is gone: left alone", ctx.getOpenSpellRowGroups(orphaned), []);
  const mine = sorcerer();
  delete mine.data.spells[0].data.auto;
  assert("an entry the player made: left alone", ctx.getOpenSpellRowGroups(mine), []);

  assert(
    "the wizard's summary",
    ctx.getOpenSpellRowsSummary(record),
    [`Sorcerer Spells: ${emptyCount(entry, "cantrips")} cantrips and ${emptyCount(entry, "spells1")} 1st-rank spells`],
  );
}

section("The query and the row");
{
  const query = ctx.getSpellSlotQuery("Occult", 0).query;
  assert("cantrips: up to 1st", query.$or[0], { "data.level": { $lte: 1 } });
  assert("cantrips: the cantrip trait", query.$and[1], { "data.traits": { $elemMatch: { $regex: "^cantrip$", $options: "i" } } });
  assert("the tradition by trait or tradition", query.$and[0].$or.length, 2);
  const third = ctx.getSpellSlotQuery("Divine", 3, ["Heal"]).query;
  assert("a rank: up to it", third.$or[0], { "data.level": { $lte: 3 } });
  assert("a rank: no cantrips", Object.keys(third.$and[1]["data.traits"]), ["$not"]);
  assert("spells it has are left out", third.$and[2], { name: { $nin: ["Heal"] } });

  const slot = ctx.buildSpellRow("spontaneous", 1, 2);
  const row = ctx.buildFilledSpellRow(slot, spell("Breathe Fire"), "spontaneous");
  assert("keeps the row's id and order", [row._id, row.data.slotOrder], [slot._id, 2]);
  assert("the spell's own data", [row.name, row.data.type, row.data.level, row.data.defenseString], ["Breathe Fire", "spell", 1, "Basic Reflex"]);
  assert(
    "spontaneous: Signature shown, no used box",
    [row.fields.signatureBox.hidden, row.fields.used.hidden, row.fields.spellSlot.hidden, row.fields.spellDetails.hidden],
    [false, true, true, false],
  );
  const prepared = ctx.buildFilledSpellRow(ctx.buildSpellRow("prepared", 1, 0), spell("Breathe Fire"), "prepared");
  assert("prepared: a used box, no Signature", [prepared.fields.used.hidden, prepared.fields.signatureBox.hidden], [false, true]);
  const cantrip = ctx.buildFilledSpellRow(ctx.buildSpellRow("prepared", 0, 0), spell("Shield", 1, ["Cantrip"]), "prepared");
  assert("a cantrip: no used box", cantrip.fields.used.hidden, true);
  const innate = ctx.buildFilledSpellRow(slot, spell("Darkness", 2), "innate");
  assert("innate: its box", [innate.fields.innateBox.hidden, innate.fields.used.hidden], [false, true]);
}

section("Picking at Level Up");
{
  const record = sorcerer();
  const cantrips = ["Shield", "Detect Magic", "Light", "Prestidigitation", "Ignition", "Telekinetic Hand"].map((n) =>
    spell(n, 1, ["Cantrip"]),
  );
  const state = runPicks(record, (prompt) =>
    prompt.title.endsWith("Cantrips") ? cantrips : [spell("Force Barrage"), spell("Fear"), spell("Sleep"), spell("Grease")],
  );
  const entry = state.record.data.spells[0];
  assert("a prompt per rank", state.prompts.map((p) => p.title), ["Sorcerer Spells: Cantrips", "Sorcerer Spells: 1st-Rank Spells"]);
  assert("as many picks as empty rows", state.prompts.map((p) => p.count), [
    emptyCount(record.data.spells[0], "cantrips"),
    emptyCount(record.data.spells[0], "spells1"),
  ]);
  assert("the repertoire text", state.prompts[1].text, `Add up to ${state.prompts[1].count} 1st-rank spells to your repertoire. Skip to choose later: the wand on an empty row picks one.`);
  assert("one write per prompt", state.writes, 2);
  assert("then the next step, once", state.nextCalls, 1);
  assert("no empty rows left", ctx.getOpenSpellRowGroups(state.record), []);
  assert("the spells in order", entry.data.spells1.map((r) => r.name), ["Force Barrage", "Fear", "Sleep", "Grease"].slice(0, state.prompts[1].count));
  assert("extra picks are left out", entry.data.cantrips.map((r) => r.name).includes("Telekinetic Hand"), false);

  // A repertoire learns a spell once
  const second = sorcerer(2);
  second.data.spells[0].data.spells1[0] = ctx.buildFilledSpellRow(second.data.spells[0].data.spells1[0], spell("Fear"), "spontaneous");
  const queries = runPicks(second, () => []).prompts.map((p) => p.query.query.$and[2]);
  assert("the repertoire's spells are left out", queries[1], { name: { $nin: ["Fear"] } });

  const skipped = runPicks(sorcerer(), () => []);
  assert("skipping: every group asked once, nothing written", [skipped.prompts.length, skipped.writes, skipped.nextCalls], [2, 0, 1]);
  const partly = runPicks(sorcerer(), (p) => (p.title.endsWith("Cantrips") ? [] : [spell("Fear")]));
  assert("fewer picks than rows: asked once", partly.prompts.length, 2);
  assert("the rest stay empty", emptyCount(partly.record.data.spells[0], "spells1"), emptyCount(sorcerer().data.spells[0], "spells1") - 1);

  const none = runPicks(synced(character("Fighter", 2)), () => []);
  assert("not a caster: straight on", [none.prompts.length, none.nextCalls], [0, 1]);
}

section("Prepared casters");
{
  const record = synced(character("Wizard", 1));
  record.data.spells[0].data.knownSpells = [spell("Fear"), spell("Force Barrage"), spell("Shield", 1, ["Cantrip"]), spell("Darkness", 2)];
  const state = runPicks(record, (prompt) => (prompt.options ? [prompt.options[0].value] : []));
  const first = state.prompts.find((p) => p.title.endsWith("1st-Rank Spells"));
  assert("the Available Spells of the rank are offered", first.options.map((o) => o.label), ["Fear", "Force Barrage"]);
  assert("no compendium query then", first.query, null);
  assert("the text says prepare", first.text.startsWith("Prepare up to"), true);
  const entry = state.record.data.spells.find((e) => e.data.auto?.source === "class:wizard");
  assert("the picked spell is prepared", entry.data.spells1[0].name, "Fear");
  const noKnown = runPicks(synced(character("Wizard", 1)), () => []);
  assert("without Available Spells: the compendium", noKnown.prompts.every((p) => p.query && !p.options), true);
}

section("Divine Font");
{
  const heal = spell("Heal");
  const harm = spell("Harm");
  const fontOf = (record) => record.data.spells.find((e) => /:font$/.test(e.data.auto?.source || ""));
  const healer = synced(character("Cleric", 1, { flags: { divineFont: "heal" } }));
  const state = runPicks(healer, () => [], [heal, harm]);
  const font = fontOf(state.record);
  assert("the chosen font fills every slot", font.data.spells1.map((r) => r.name), fontOf(healer).data.spells1.map(() => "Heal"));
  assert("without asking", state.prompts.some((p) => p.title === "Divine Font"), false);

  const unchosen = synced(character("Cleric", 1));
  const asked = runPicks(unchosen, (p) => (p.title === "Divine Font" ? [harm._id] : []), [heal, harm]);
  const prompt = asked.prompts.find((p) => p.title === "Divine Font");
  assert("no font yet: heal or harm", prompt.options.map((o) => o.label), ["Heal", "Harm"]);
  assert("the pick fills every slot", fontOf(asked.record).data.spells1.every((r) => r.name === "Harm"), true);
  const missing = runPicks(synced(character("Cleric", 1, { flags: { divineFont: "heal" } })), () => [], []);
  assert("the spell isn't in the campaign: left empty", missing.writes, 0);
}

section("The sheet and the wizard use them");
{
  const read = (file) => fs.readFileSync(`${__dirname}/../${file}`, "utf8");
  const sheet = read("characters-main.html");
  assert("Level Up ends with the pickers", /promptSpellPicks\(record\._id, next\)\);\s*runLevelUpSteps\(steps, 0, newLevel\)/.test(sheet), true);
  assert("1st level from level 0 too", /promptSpellPicks\(record\._id, next\)\);\s*runLevelUpSteps\(steps, 0, 1\)/.test(sheet), true);
  const list = read("spell-list.html");
  assert("a dropped spell's row", list.includes("buildFilledSpellRow("), true);
  assert("the wand's query", list.includes("getSpellSlotQuery(tradition, spellSlotLevel)"), true);
  const config = JSON.parse(read("ruleset.config.json"));
  const steps = JSON.stringify(config).includes('"file":"wizards/characters/spells.html"');
  assert("the wizard's Spells step", steps, true);
  assert("the script is loaded", JSON.stringify(config).includes('"file":"rollhandlers/spell-pickers.js"'), true);
}

summary();
