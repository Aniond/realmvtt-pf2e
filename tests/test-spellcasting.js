// Tests for the spellcasting entries made from the class: slot tables, the
// sync run by onAddEditFeature, adoption of existing entries, and the Level Up
// summary lines.

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const {
  assert,
  assertIncludes,
  assertNotIncludes,
  section,
  summary,
} = require("./test-helpers");

const ctx = createSandbox();
// spells.js shares the sheet's scope with common.js at runtime; load it for
// the entry builders it now uses
new vm.Script(fs.readFileSync(__dirname + "/../rollhandlers/spells.js", "utf8"), {
  filename: "spells.js",
}).runInContext(ctx);

// Spells per Day tables from Archives of Nethys
const AON = require("./spell-slots-aon.json");

const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

function classRecord(name, remaster = true, data = {}) {
  return {
    _id: `class-${name}`,
    name,
    recordType: "class",
    data: {
      publication: {
        remaster,
        title: remaster ? "Pathfinder Player Core" : "Pathfinder Secrets of Magic",
      },
      features: [],
      ...data,
    },
  };
}

function character(classObj, level, data = {}) {
  return {
    _id: "pc",
    name: "Ezren",
    recordType: "characters",
    data: {
      level,
      classes: classObj ? [classObj] : [],
      spellcasting: "1",
      int: 4,
      wis: 4,
      cha: 4,
      ...data,
    },
    fields: {},
  };
}

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
function syncValues(record) {
  const values = {};
  const entries = ctx.syncSpellcastingEntries(record, values);
  ctx.updateSpellcastingEntries(record, values, entries);
  return values;
}
const synced = (record) => apply(record, syncValues(record));
const atLevel = (record, level) => synced(apply(record, { "data.level": level }));
const spellKeys = (values) =>
  Object.keys(values).filter((key) => key === "data.spells" || key.startsWith("data.spells."));
const entryFor = (record, source) =>
  (record.data.spells || []).find((entry) => entry.data?.auto?.source === source);
const counts = (entry) => {
  const result = {};
  for (let rank = 1; rank <= 10; rank++) {
    const count = entry.data[`numSpells${rank}`] || 0;
    if (count) result[rank] = count;
  }
  return result;
};
const filled = (name, extra = {}) => ({
  _id: `spell-${name}`,
  name,
  recordType: "spells",
  data: { type: "spell", level: 1, ...extra },
  fields: { spellDetails: { hidden: false }, spellSlot: { hidden: true } },
});
// Puts a spell into an entry's list at a row
function fillRow(record, source, list, index, spell) {
  const next = JSON.parse(JSON.stringify(record));
  const entry = entryFor(next, source);
  entry.data[list][index] = { ...spell, _id: entry.data[list][index]?._id || spell._id };
  return next;
}

// An entry the player made with the Add Spellcasting Entry popover
const playerEntry = (name, data) => ({
  name,
  unidentifiedName: "Spellcasting Entry",
  identified: true,
  data: { type: "prepared", tradition: "Arcane", attribute: "int", training: 1, ...data },
  fields: {},
});
// A list of prepared rows: the spells named, then empty slots up to count
const preparedRows = (rank, count, spells = []) => [
  ...spells.map((name) => filled(name, { level: rank })),
  ...Array.from({ length: count - spells.length }, (_, i) =>
    ctx.buildSpellRow("prepared", rank, spells.length + i),
  ),
];
const names = (record) => (record.data.spells || []).map((entry) => entry.name);
const sources = (record) => (record.data.spells || []).map((entry) => entry.data.auto?.source || null);

// Picks a rank in an entry's training dropdown, as the sheet does
function pickTraining(record, index, value) {
  let written = {};
  const original = ctx.api.setValues;
  ctx.api.setValues = (values) => {
    written = values;
  };
  const picked = apply(record, { [`data.spells.${index}.data.training`]: value });
  ctx.updateSpellcastingEntry(
    picked,
    JSON.parse(JSON.stringify(picked.data.spells[index])),
    `data.spells.${index}`,
    false,
    true,
  );
  ctx.api.setValues = original;
  return apply(picked, written);
}

const bloodline = (name, tradition, withRollOption = true) => ({
  _id: `bloodline-${name}`,
  name: `Bloodline: ${name}`,
  recordType: "features",
  data: {
    type: "classfeature",
    level: 1,
    description: `<p>Blood.</p>\n<p><strong>Tradition</strong> ${tradition}</p>`,
    modifiers: withRollOption
      ? [{ data: { type: "rollOption", option: `feature:bloodline:tradition:${tradition}` } }]
      : [],
  },
});
const sorcererWith = (feature, flags) =>
  character(classRecord("Sorcerer", true, { features: feature ? [feature] : [] }), 1, {
    flags,
  });

section("getSpellSlotCount matches the Archives of Nethys tables");
{
  for (const [table, ranks] of Object.entries(AON.tables)) {
    const mismatches = [];
    for (let rank = 1; rank <= 10; rank++) {
      for (const level of LEVELS) {
        const expected = ranks[rank]?.[level - 1] || 0;
        const actual = ctx.getSpellSlotCount(table, rank, level);
        if (actual !== expected) mismatches.push(`rank ${rank} L${level}: ${actual}`);
      }
    }
    assert(`${table} (all ranks, levels 1-20)`, mismatches, []);
  }
  assert("unknown table has no slots", ctx.getSpellSlotCount("NONE", 1, 5), 0);
  assert("level 0 has no slots", ctx.getSpellSlotCount("FULL3", 1, 0), 0);
}

section("Every caster class and edition against the tables");
{
  const classNames = {
    bard: "Bard",
    cleric: "Cleric",
    druid: "Druid",
    sorcerer: "Sorcerer",
    oracle: "Oracle",
    witch: "Witch",
    wizard: "Wizard",
    magus: "Magus",
    summoner: "Summoner",
    psychic: "Psychic",
    animist: "Animist",
    necromancer: "Necromancer",
  };
  for (const [slug, name] of Object.entries(classNames)) {
    for (const edition of Object.keys(AON.classes[slug])) {
      const rules = AON.classes[slug][edition];
      const mismatches = [];
      for (const level of LEVELS) {
        const record = character(classRecord(name, edition === "remaster"), level);
        const spec = ctx.getWantedSpellcastingEntries(record, level)[0];
        const studious = rules.bonus?.studiousRank?.[level - 1];
        for (let rank = 1; rank <= 10; rank++) {
          const expected =
            (AON.tables[rules.slots][rank]?.[level - 1] || 0) +
            (studious === rank ? rules.bonus.studiousSlots : 0);
          const actual = spec.counts[`numSpells${rank}`];
          if (actual !== expected) mismatches.push(`L${level} rank ${rank}: ${actual}`);
        }
        // The Advanced Player's Guide oracle also knows its mystery's cantrip,
        // and a psychic their psi cantrips
        const cantrips =
          (Array.isArray(rules.cantrips) ? rules.cantrips[level - 1] : rules.cantrips) +
          (slug === "oracle" && edition === "legacy" ? 1 : 0) +
          (rules.type === "spontaneous" ? rules.psiCantrips?.[level - 1] || 0 : 0);
        const actualCantrips =
          rules.type === "prepared" ? spec.counts.numCantrips : spec.repertoire.repCantrips;
        if (actualCantrips !== cantrips) mismatches.push(`L${level} cantrips: ${actualCantrips}`);
        if (spec.type !== rules.type) mismatches.push(`L${level} type ${spec.type}`);
        if (!rules.tradition.startsWith("by") && spec.tradition !== rules.tradition) {
          mismatches.push(`L${level} tradition ${spec.tradition}`);
        }
        if (!rules.attribute.startsWith("by") && spec.attribute !== rules.attribute) {
          mismatches.push(`L${level} attribute ${spec.attribute}`);
        }
      }
      assert(`${name} (${edition})`, mismatches, []);
    }
  }

  // The animist's apparition entry
  const apparition = AON.classes.animist_apparition.remaster;
  const mismatches = [];
  for (const level of LEVELS) {
    const spec = ctx
      .getWantedSpellcastingEntries(character(classRecord("Animist"), level), level)
      .find((s) => s.source === "class:animist:apparition");
    for (let rank = 1; rank <= 10; rank++) {
      const expected = AON.tables.APPARITION[rank]?.[level - 1] || 0;
      if (spec.counts[`numSpells${rank}`] !== expected) mismatches.push(`L${level} rank ${rank}`);
    }
    if (spec.repertoire.repCantrips !== apparition.cantrips[level - 1]) {
      mismatches.push(`L${level} cantrips`);
    }
  }
  assert("Animist apparition entry", mismatches, []);

  const fighter = character(classRecord("Fighter"), 5);
  assert("fighter has no entries", ctx.getWantedSpellcastingEntries(fighter, 5).length, 0);
  const champion = character(classRecord("Champion"), 5);
  assert("champion (focus spells only) has no entries", ctx.getWantedSpellcastingEntries(champion, 5).length, 0);
  const homebrew = character(classRecord("Wizard (Homebrew)"), 1);
  assert("a tag after the class name is ignored", ctx.getWantedSpellcastingEntries(homebrew, 1)[0]?.source, "class:wizard");
}

section("getSpellcastingEdition");
{
  assert("remaster flag", ctx.getSpellcastingEdition({ data: { publication: { remaster: true } } }), "remaster");
  assert("legacy flag", ctx.getSpellcastingEdition({ data: { publication: { remaster: false } } }), "legacy");
  assert(
    "no flag: Secrets of Magic is legacy",
    ctx.getSpellcastingEdition({ data: { publication: { title: "Pathfinder Secrets of Magic" } } }),
    "legacy",
  );
  assert(
    "no flag: Dark Archive (Remastered) is remaster",
    ctx.getSpellcastingEdition({ data: { publication: { title: "Pathfinder Dark Archive (Remastered)" } } }),
    "remaster",
  );
  assert("no publication is remaster", ctx.getSpellcastingEdition({ data: {} }), "remaster");
}

section("Wizard school slots");
{
  const wizard = (school, level = 1) =>
    character(classRecord("Wizard"), level, school ? { flags: { arcaneSchool: school } } : {});
  const spec = (record, level = 1) => ctx.getWantedSpellcastingEntries(record, level)[0];

  const battle = spec(wizard("school-of-battle-magic"));
  assert("Battle Magic: 6 cantrips", battle.counts.numCantrips, 6);
  assert("Battle Magic: 3 1st-rank slots", battle.counts.numSpells1, 3);
  const unified = spec(wizard("school-of-unified-magical-theory"));
  assert("Unified Magical Theory: 5 cantrips", unified.counts.numCantrips, 5);
  assert("Unified Magical Theory: 2 1st-rank slots", unified.counts.numSpells1, 2);
  const none = spec(wizard(null));
  assert("no school chosen yet: 2 slots", none.counts.numSpells1, 2);
  const legacy = character(classRecord("Wizard", false), 1, { flags: { arcaneSchool: "universalist" } });
  assert("Universalist: no school slot", spec(legacy).counts.numSpells1, 2);
  const high = spec(wizard("school-of-battle-magic", 19), 19);
  assert("school slot at 9th rank", high.counts.numSpells9, 4);
  assert("no school slot at 10th rank", high.counts.numSpells10, 1);
  assert("no school slot at an empty rank", spec(wizard("school-of-mentalism", 2), 2).counts.numSpells2, 0);
}

section("Cleric Divine Font");
{
  const cleric = (level, data = {}, remaster = true) =>
    character(classRecord("Cleric", remaster), level, data);
  const font = (record, level) =>
    ctx.getWantedSpellcastingEntries(record, level).find((s) => s.source === "class:cleric:font");

  const at1 = font(cleric(1), 1);
  assert("font is its own entry", at1.name, "Divine Font");
  assert("level 1: 4 slots at 1st rank", counts({ data: at1.counts }), { 1: 4 });
  assert("level 5: 5 slots at 3rd rank", counts({ data: font(cleric(5), 5).counts }), { 3: 5 });
  assert("level 15: 6 slots at 8th rank", counts({ data: font(cleric(15), 15).counts }), { 8: 6 });
  assert("level 19: stays at 9th rank", counts({ data: font(cleric(19), 19).counts }), { 9: 6 });
  assert("level 20: stays at 9th rank", font(cleric(20), 20).fontRank, 9);
  assert("no font cantrips", at1.counts.numCantrips, 0);
  assert("legacy font: 1 + Charisma", counts({ data: font(cleric(1, { cha: 3 }, false), 1).counts }), { 1: 4 });
  assert("harmful font", font(cleric(1, { flags: { divineFont: "harm" } }), 1).spellFilter, ["harm"]);
  assert("healing font", font(cleric(1, { flags: { divineFont: "heal" } }), 1).spellFilter, ["heal"]);

  // Prepared font spells move up with the font's rank
  let record = synced(cleric(4));
  const fontEntry = entryFor(record, "class:cleric:font");
  assert("level 4: 4 font slots at 2nd rank", fontEntry.data.spells2.length, 4);
  record = fillRow(record, "class:cleric:font", "spells2", 0, filled("Heal", { used: true }));
  record = atLevel(record, 5);
  const moved = entryFor(record, "class:cleric:font");
  assert("level 5: 2nd rank empty", (moved.data.spells2 || []).length, 0);
  assert("level 5: 5 rows at 3rd rank", moved.data.spells3.length, 5);
  assert("heal moved to 3rd rank", moved.data.spells3[0].name, "Heal");
  assert("moved spell stays expended", moved.data.spells3[0].data.used, true);
  assert("font shows only 3rd rank", moved.data.shownSpells, ["spells3"]);
  assert("main entry untouched by the font", counts(entryFor(record, "class:cleric")), { 1: 3, 2: 3, 3: 2 });
}

section("Legacy magus (Secrets of Magic)");
{
  const magus = (level) => character(classRecord("Magus", false), level);
  const spec = (level) => ctx.getWantedSpellcastingEntries(magus(level), level)[0];
  assert("level 7: 3rd and 4th, studious 2nd", counts({ data: spec(7).counts }), { 2: 2, 3: 2, 4: 2 });
  assert("level 11: 5th and 6th, studious 3rd", counts({ data: spec(11).counts }), { 3: 2, 5: 2, 6: 2 });
  assert("level 13: 6th and 7th, studious 4th", counts({ data: spec(13).counts }), { 4: 2, 6: 2, 7: 2 });
  assert("remaster magus keeps every rank", counts({ data: ctx.getWantedSpellcastingEntries(character(classRecord("Magus"), 5), 5)[0].counts }), { 1: 2, 2: 2, 3: 1 });

  // Bounded ranks vanish; a prepared spell left behind stays
  let record = synced(magus(4));
  record = fillRow(record, "class:magus", "spells1", 0, filled("Shield"));
  record = atLevel(record, 5);
  const entry = entryFor(record, "class:magus");
  assert("level 5: no 1st-rank slots", entry.data.numSpells1, 0);
  assert("prepared 1st-rank spell kept", entry.data.spells1.map((row) => row.name), ["Shield"]);
  assert("1st rank still shown", entry.data.shownSpells.includes("spells1"), true);
  assert("2nd rank has 2 slots", entry.data.spells2.length, 2);

  let empty = atLevel(synced(magus(4)), 5);
  assert("an empty vanished rank is hidden", entryFor(empty, "class:magus").data.shownSpells.includes("spells1"), false);
  assert("its box too", entryFor(empty, "class:magus").fields.spells1Box.hidden, true);
}

section("Traditions from bloodline, patron and eidolon");
{
  const traditionOf = (record) => ctx.getWantedSpellcastingEntries(record, 1)[0].tradition;
  const bloodlines = {
    Aberrant: "occult",
    Angelic: "divine",
    Demonic: "divine",
    Diabolic: "divine",
    Elemental: "primal",
    Fey: "primal",
    Hag: "occult",
    Imperial: "arcane",
    Undead: "divine",
  };
  for (const [name, tradition] of Object.entries(bloodlines)) {
    const record = sorcererWith(bloodline(name, tradition), { bloodline: `bloodline-${name.toLowerCase()}` });
    assert(`${name} bloodline`, traditionOf(record), ctx.capitalize(tradition));
  }

  const angelicText = {
    ...bloodline("Angelic", "divine", false),
    data: { type: "classfeature", level: 1, description: "<p><strong>Spell List</strong> divine</p>" },
  };
  assert("from the Spell List line", traditionOf(sorcererWith(angelicText, { bloodline: "bloodline-angelic" })), "Divine");
  assert("from the name when the feature is missing", traditionOf(sorcererWith(null, { bloodline: "bloodline-hag" })), "Occult");
  assert("no bloodline chosen yet", traditionOf(sorcererWith(null, {})), null);

  const draconic = {
    ...bloodline("Draconic", "variable", false),
    data: {
      type: "classfeature",
      level: 1,
      description: "<p><strong>Tradition</strong> variable (see Draconic Exemplars below)</p>",
      modifiers: [
        {
          data: {
            type: "rollOption",
            option: "feature:bloodline:tradition:{item|flags.pf2e.rulesSelections.dragonBloodline.tradition}",
          },
        },
      ],
    },
  };
  const dragon = (value) =>
    traditionOf(sorcererWith(draconic, { bloodline: "bloodline-draconic", ...(value ? { dragonBloodline: value } : {}) }));
  assert("Draconic: arcane dragon", dragon("arcane-dragon"), "Arcane");
  assert("Draconic: primal dragon", dragon("primal-dragon"), "Primal");
  assert("Draconic: fortune dragon", dragon("fortune-dragon"), "Arcane");
  assert("Draconic: omen dragon", dragon("omen-dragon"), "Occult");
  assert("Draconic: empyreal dragon", dragon("empyreal-dragon"), "Divine");
  assert("Draconic: adamantine dragon", dragon("adamantine-dragon"), "Primal");
  assert("Draconic: legacy dragon defaults to arcane", dragon("red-dragon"), "Arcane");
  assert("Draconic before the dragon is chosen", dragon(null), null);
  assert("Draconic: brine dragon (Draconic Codex)", dragon("brine-dragon"), "Primal");
  assert("Draconic: sovereign dragon", dragon("sovereign-dragon"), "Occult");
  assert("Draconic: sky dragon", dragon("sky-dragon"), "Divine");
  assert("Draconic: umbral dragon", dragon("umbral-dragon"), "Occult");
  assert("Draconic: magma dragon", dragon("magma-dragon"), "Primal");

  // An unknown tradition leaves the entry's empty until the choice is made
  let record = synced(sorcererWith(draconic, { bloodline: "bloodline-draconic" }));
  assert("entry made without a tradition", entryFor(record, "class:sorcerer").data.tradition, "");
  assert("entry named for the class", entryFor(record, "class:sorcerer").name, "Sorcerer Spells");
  record = synced(apply(record, { "data.flags.dragonBloodline": "omen-dragon" }));
  assert("tradition set once chosen", entryFor(record, "class:sorcerer").data.tradition, "Occult");
  record = synced(apply(record, { "data.spells.0.data.tradition": "Primal" }));
  record = synced(apply(record, { "data.flags.dragonBloodline": "arcane-dragon" }));
  assert("the player's own tradition is kept", entryFor(record, "class:sorcerer").data.tradition, "Primal");

  const patron = {
    _id: "patron",
    name: "Wilding Steward",
    data: { type: "classfeature", level: 1, description: "<p><strong>Spell List</strong> primal</p>" },
  };
  const witch = (feature, value) =>
    character(classRecord("Witch", true, { features: feature ? [feature] : [] }), 1, { flags: { patron: value } });
  assert("witch patron", ctx.getWantedSpellcastingEntries(witch(patron, "wilding-steward"), 1)[0].tradition, "Primal");
  assert("witch patron by name", ctx.getWantedSpellcastingEntries(witch(null, "faiths-flamekeeper"), 1)[0].tradition, "Divine");

  const eidolon = {
    _id: "eidolon",
    name: "Angel Eidolon",
    recordType: "features",
    data: { type: "classfeature", level: 1, description: "<p><strong>Tradition</strong> divine</p>" },
  };
  const summoner = character(classRecord("Summoner", false), 1, { bonusFeats: [eidolon], flags: { eidolon: "angel-eidolon" } });
  assert("summoner eidolon", ctx.getWantedSpellcastingEntries(summoner, 1)[0].tradition, "Divine");
}

section("Psychic attribute");
{
  const psychic = (data) => character(classRecord("Psychic", false), 1, data);
  const attribute = (record) => ctx.getWantedSpellcastingEntries(record, 1)[0].attribute;
  assert("key attribute Charisma", attribute(psychic({ keyAbility: "cha" })), "cha");
  assert("key attribute Intelligence", attribute(psychic({ keyAbility: "int" })), "int");
  assert("no key yet: the higher of the two", attribute(psychic({ keyAbility: "none", int: 2, cha: 4 })), "cha");

  let record = synced(psychic({ keyAbility: "int" }));
  record = synced(apply(record, { "data.keyAbility": "cha" }));
  assert("entry follows a new key attribute", record.data.spells[0].data.attribute, "cha");

  // The subconscious mind names the attribute, even over the class's default key
  const withMind = (name, slug, ability, data) =>
    character(
      classRecord("Psychic", false, {
        keyAbility: ["int", "cha"],
        features: [
          { _id: slug, name, recordType: "features", data: { type: "classfeature", level: 1, keyOptions: [ability] } },
        ],
      }),
      1,
      { flags: { subconsciousMind: slug }, ...data },
    );
  assert(
    "Emotional Acceptance over a default Intelligence key",
    attribute(withMind("Emotional Acceptance", "emotional-acceptance", "cha", { keyAbility: "int", int: 4, cha: 3 })),
    "cha",
  );
  assert(
    "Gathered Lore before a key is chosen",
    attribute(withMind("Gathered Lore", "gathered-lore", "int", { keyAbility: "none", int: 3, cha: 4 })),
    "int",
  );
  assert(
    "a mind that isn't on the character falls back to the key attribute",
    attribute(psychic({ keyAbility: "cha", flags: { subconsciousMind: "gathered-lore" } })),
    "cha",
  );
  const psychic6 = ctx.getWantedSpellcastingEntries(character(classRecord("Psychic", false), 6), 6)[0];
  assert("psychic: 3 cantrips plus 4 psi cantrips at 6th", psychic6.repertoire.repCantrips, 7);
}

section("New entries");
{
  const wizard = synced(character(classRecord("Wizard"), 1, { flags: { arcaneSchool: "school-of-battle-magic" } }));
  const entry = wizard.data.spells[0];
  assert("one entry", wizard.data.spells.length, 1);
  assert("named for the class", entry.name, "Wizard Spells");
  assert("has an id", typeof entry._id, "string");
  assert("managed", entry.data.auto.source, "class:wizard");
  assert("synced version", entry.data.auto.version, 1);
  assert("Set slots from level is on", entry.data.autoSlots, true);
  assert("its checkbox shows", entry.fields.autoSlots.hidden, false);
  assert("prepared, arcane, Intelligence", [entry.data.type, entry.data.tradition, entry.data.attribute], ["prepared", "Arcane", "int"]);
  assert("6 cantrip slots", entry.data.cantrips.length, 6);
  assert("3 1st-rank slots", entry.data.spells1.map((row) => row.name), ["Rank 1 Spell Slot", "Rank 1 Spell Slot", "Rank 1 Spell Slot"]);
  assert("shows cantrips and 1st rank", entry.data.shownSpells, ["cantrips", "spells1"]);
  assert("2nd rank box hidden", entry.fields.spells2Box.hidden, true);
  assert("trained: Mod = Int + 2 + level", entry.data.mod, 7);
  assert("DC", entry.data.dc, 17);
  assert("training", entry.data.training, 1);
  assert("first entry has no move up button", entry.fields.moveUpBtn.hidden, true);
  assert("character version written", wizard.data.spellcastingSyncVersion, 1);

  const sorcerer = synced(sorcererWith(bloodline("Aberrant", "occult"), { bloodline: "bloodline-aberrant" }));
  const spontaneous = sorcerer.data.spells[0];
  assert("spontaneous: 3 slots", spontaneous.data.numSpells1, 3);
  assert("spontaneous: all 3 left", spontaneous.data.usedSpells1, 3);
  assert("5 cantrip placeholders", spontaneous.data.cantrips.map((row) => row.name).join(","), Array(5).fill("New Cantrip").join(","));
  assert("3 repertoire placeholders", spontaneous.data.spells1.length, 3);
  assert("placeholders can be deleted", spontaneous.data.spells1[0].fields.deleteBtn.hidden, false);
  assert("spontaneous fields shown", spontaneous.fields.spontaneousBox.hidden, false);
  assert("no cantrip count for spontaneous", spontaneous.data.numCantrips, undefined);

  const bard = ctx.getWantedSpellcastingEntries(character(classRecord("Bard"), 1), 1)[0];
  assert("bard: the muse's spell joins the repertoire", bard.repertoire.rep1, 3);
  const psychic = ctx.getWantedSpellcastingEntries(character(classRecord("Psychic", false), 19, { keyAbility: "int" }), 19)[0];
  assert("psychic: conscious mind spell per rank", psychic.repertoire.rep1, 3);
  assert("psychic: 2 10th-rank spells", psychic.repertoire.rep10, 2);

  // Secrets of Magic summoner: two 1st-rank spells, 5 in all from 4th level
  const summonerTotals = LEVELS.map((level) => {
    const rep = ctx.getWantedSpellcastingEntries(character(classRecord("Summoner", false), level), level)[0].repertoire;
    return LEVELS.slice(0, 10).reduce((total, rank) => total + rep[`rep${rank}`], 0);
  });
  assert("legacy summoner: repertoire of 2, 3, 4, then 5", summonerTotals, [2, 3, 4, ...Array(17).fill(5)]);
  const summoner5 = ctx.getWantedSpellcastingEntries(character(classRecord("Summoner", false), 5), 5)[0];
  assert("legacy summoner at 5th: the extra spell at the lower rank", [summoner5.repertoire.rep2, summoner5.repertoire.rep3], [3, 2]);
  const remasterSummoner = ctx.getWantedSpellcastingEntries(character(classRecord("Summoner"), 1), 1)[0];
  assert("remaster summoner: one 1st-rank spell", remasterSummoner.repertoire.rep1, 1);

  const animist = synced(character(classRecord("Animist"), 1));
  assert("animist has two entries", animist.data.spells.map((e) => e.name), ["Animist Spells", "Apparition Spells"]);
  const apparition = entryFor(animist, "class:animist:apparition");
  assert("apparition entry is spontaneous", apparition.data.type, "spontaneous");
  assert("apparition repertoire: a spell per attuned apparition", apparition.data.spells1.length, 2);
  assert("second entry has a move up button", apparition.fields.moveUpBtn.hidden, false);
  const at7 = ctx.getWantedSpellcastingEntries(character(classRecord("Animist"), 7), 7)[1];
  assert("apparition at 7th: 3 cantrips", at7.repertoire.repCantrips, 3);
  assert("apparition at 7th: 3 spells of each rank", [at7.repertoire.rep1, at7.repertoire.rep4], [3, 3]);
}

section("Leveling up");
{
  let record = synced(sorcererWith(bloodline("Fey", "primal"), { bloodline: "bloodline-fey" }));
  record = apply(record, { "data.spells.0.data.usedSpells1": 1 });
  record = atLevel(record, 2);
  let entry = record.data.spells[0];
  assert("level 2: 4 1st-rank slots", entry.data.numSpells1, 4);
  assert("the new slot can be cast at once", entry.data.usedSpells1, 2);
  assert("a 4th repertoire placeholder", entry.data.spells1.length, 4);

  // A placeholder the player deleted stays deleted
  record = apply(record, { "data.spells.0.data.spells1": entry.data.spells1.slice(1) });
  record = atLevel(record, 3);
  entry = record.data.spells[0];
  assert("deleted placeholder stays deleted", entry.data.spells1.length, 3);
  assert("level 3: 2nd-rank placeholders", entry.data.spells2.length, 3);
  assert("2nd-rank slots left", entry.data.usedSpells2, 3);
  assert("2nd rank shown", entry.data.shownSpells.includes("spells2"), true);

  // Lowering the level removes empty slots only
  let wizard = synced(character(classRecord("Wizard"), 5));
  wizard = fillRow(wizard, "class:wizard", "spells3", 0, filled("Fireball", { level: 3 }));
  wizard = atLevel(wizard, 3);
  const lowered = entryFor(wizard, "class:wizard");
  assert("level 3: no 3rd-rank slots", lowered.data.numSpells3, 0);
  assert("prepared 3rd-rank spell stays", lowered.data.spells3.map((row) => row.name), ["Fireball"]);
}

section("Player changes survive leveling up");
{
  let record = synced(character(classRecord("Wizard"), 1, { flags: { arcaneSchool: "school-of-battle-magic" } }));
  record = apply(record, { "data.spells.0.data.numSpells1": 4, "data.spells.0.data.numCantrips": 5 });
  record = atLevel(record, 2);
  let entry = record.data.spells[0];
  assert("an extra slot is kept on top of the table", entry.data.numSpells1, 5);
  assert("a removed cantrip slot stays removed", entry.data.numCantrips, 5);
  assert("rows match the counts", [entry.data.spells1.length, entry.data.cantrips.length], [5, 5]);
  record = atLevel(record, 3);
  entry = record.data.spells[0];
  assert("still one above the table", entry.data.numSpells1, 5);
  assert("new rank from the table", entry.data.numSpells2, 3);

  // Set slots from level off: the sync leaves counts and rows alone
  record = synced(apply(record, { "data.spells.0.data.autoSlots": false }));
  record = atLevel(record, 5);
  entry = record.data.spells[0];
  assert("off: no 3rd-rank slots added", entry.data.numSpells3 || 0, 0);
  assert("off: 2nd rank unchanged", entry.data.numSpells2, 3);
  assert("off: the checkbox still shows", entry.fields.autoSlots.hidden, false);
  assert("off: no Level Up lines", ctx.getSpellcastingLevelUpChanges(record, 6), []);
  record = synced(apply(record, { "data.spells.0.data.autoSlots": true }));
  entry = record.data.spells[0];
  assert("back on: 3rd rank from the table", entry.data.numSpells3, 3);
  assert("back on: the extra slot is still there", entry.data.numSpells1, 5);

  // Counts typed while it was off aren't added on top of the table again
  let r = synced(character(classRecord("Wizard"), 3));
  r = synced(apply(r, { "data.spells.0.data.autoSlots": false }));
  r = atLevel(r, 5);
  r = apply(r, { "data.spells.0.data.numSpells2": 3, "data.spells.0.data.numSpells3": 2 });
  r = synced(apply(r, { "data.spells.0.data.autoSlots": true }));
  assert("back on: counts typed while off are not added twice", [r.data.spells[0].data.numSpells2, r.data.spells[0].data.numSpells3], [3, 2]);
}

section("Existing characters: adoption");
{
  const manual = (data, name = "Arcane Prepared Spells") => ({
    name,
    unidentifiedName: "Spellcasting Entry",
    identified: true,
    data: { type: "prepared", tradition: "Arcane", attribute: "int", training: 1, ...data },
    fields: { moveUpBtn: { hidden: true } },
  });
  const slots = (count, spells = []) => [
    ...spells.map((name) => filled(name)),
    ...Array.from({ length: count - spells.length }, (_, i) => ctx.buildSpellRow("prepared", 1, i)),
  ];
  const before = character(classRecord("Wizard"), 1, {
    spells: [manual({ numCantrips: 4, numSpells1: 5, spells1: slots(5, ["Grease", "Fear"]) })],
  });
  let record = synced(before);
  let entry = record.data.spells[0];
  assert("no second entry", record.data.spells.length, 1);
  assert("adopted", entry.data.auto.source, "class:wizard");
  assert("adopted entry gets an id", typeof entry._id, "string");
  assert("the player's name is kept", entry.name, "Arcane Prepared Spells");
  assert("a higher count is kept", entry.data.numSpells1, 5);
  assert("a lower count is raised", entry.data.numCantrips, 5);
  assert("chosen spells kept", entry.data.spells1.slice(0, 2).map((row) => row.name), ["Grease", "Fear"]);
  assert("table base recorded", entry.data.auto.base.numSpells1, 2);
  assert(
    "notice",
    ctx.describeSpellcastingSync(before.data.spells, record),
    'Arcane Prepared Spells now follow your level (higher counts kept). To stop this, uncheck "Set slots from level" in its settings.',
  );
  record = atLevel(record, 2);
  assert("the extra slots carry on", record.data.spells[0].data.numSpells1, 6);

  const low = synced(character(classRecord("Wizard"), 1, { spells: [manual({ numSpells1: 1 })] }));
  assert("adoption never lowers, only raises", low.data.spells[0].data.numSpells1, 2);

  const innateEntry = manual({ type: "innate", tradition: "Divine" }, "Divine Innate Spells");
  const other = synced(character(classRecord("Wizard"), 1, { spells: [innateEntry] }));
  assert("innate entries are never adopted", other.data.spells.map((e) => e.name), ["Divine Innate Spells", "Wizard Spells"]);
  assert("and are left unmanaged", other.data.spells[0].data.auto, undefined);
  assert(
    "notice for an added entry",
    ctx.describeSpellcastingSync([innateEntry], other),
    "Added from your class: Wizard Spells.",
  );

  const focus = synced(character(classRecord("Wizard"), 1, { spells: [manual({ type: "focus" }, "Arcane Focus Spells")] }));
  assert("focus entries are never adopted", focus.data.spells.length, 2);

  // Unknown tradition: only the single entry of the type is taken
  const sorcerer = sorcererWith(null, {});
  sorcerer.data.spells = [
    manual({ type: "spontaneous", tradition: "Occult", numSpells1: 3, usedSpells1: 1, spells1: [filled("Daze"), filled("Fear")] }, "Occult Spontaneous Spells"),
  ];
  record = synced(sorcerer);
  entry = record.data.spells[0];
  assert("single spontaneous entry adopted", entry.data.auto.source, "class:sorcerer");
  assert("its tradition is kept", entry.data.tradition, "Occult");
  assert("repertoire topped up to the slots", entry.data.spells1.length, 3);
  assert("slots left untouched", entry.data.usedSpells1, 1);

  const cleric = synced(
    character(classRecord("Cleric"), 1, {
      spells: [manual({ tradition: "Divine", numSpells1: 2 }, "Divine Prepared Spells")],
    }),
  );
  assert(
    "cleric: main entry adopted, font added",
    cleric.data.spells.map((e) => [e.name, e.data.auto.source]),
    [
      ["Divine Prepared Spells", "class:cleric"],
      ["Divine Font", "class:cleric:font"],
    ],
  );

  // A font entry listed first goes to the font, not the class
  const fontFirst = synced(
    character(classRecord("Cleric"), 1, {
      spells: [
        manual({ tradition: "Divine", numSpells1: 4 }, "Divine Font"),
        manual({ tradition: "Divine", numSpells1: 2 }, "Divine Prepared Spells"),
      ],
    }),
  );
  assert(
    "cleric: a font entry listed first is adopted by the font",
    fontFirst.data.spells.map((e) => [e.name, e.data.auto.source]),
    [
      ["Divine Font", "class:cleric:font"],
      ["Divine Prepared Spells", "class:cleric"],
    ],
  );

  // An archetype's entry is never taken; one named for the class wins
  const archetypeFirst = synced(
    character(classRecord("Wizard"), 6, {
      spells: [
        manual({ numCantrips: 2, numSpells1: 1 }, "Magus Dedication Spells"),
        manual({ numCantrips: 5, numSpells1: 4 }, "My Spellbook"),
        manual({ numCantrips: 5, numSpells1: 3 }, "Wizard Spells"),
      ],
    }),
  );
  assert(
    "the archetype entry is left alone, the class-named one adopted",
    archetypeFirst.data.spells.map((e) => [e.name, e.data.auto?.source || null]),
    [
      ["Magus Dedication Spells", null],
      ["My Spellbook", null],
      ["Wizard Spells", "class:wizard"],
    ],
  );

  // Unknown tradition and two entries of the type: nothing added until chosen
  const unknown = sorcererWith(null, { bloodline: "bloodline-draconic" });
  unknown.data.spells = [
    manual({ type: "spontaneous", tradition: "Arcane" }, "Arcane Spontaneous Spells"),
    manual({ type: "spontaneous", tradition: "Occult" }, "Occult Spontaneous Spells"),
  ];
  let unknownSynced = synced(unknown);
  assert("two candidates, tradition unknown: no third entry", unknownSynced.data.spells.length, 2);
  assert("and neither is taken", unknownSynced.data.spells.map((e) => e.data.auto?.source || null), [null, null]);

  assert("an outdated character needs the sync", ctx.needsSpellcastingSync(before), true);
  assert("a synced one doesn't", ctx.needsSpellcastingSync(record), false);
}

section("Deleted entries");
{
  let record = synced(character(classRecord("Wizard"), 1, { spellcastingDismissed: ["class:wizard"] }));
  assert("a dismissed entry is not made again", (record.data.spells || []).length, 0);
  assert("Restore Automatic Entries shows", record.fields.restoreSpellcastingBtn.hidden, false);
  record = atLevel(record, 2);
  assert("still not made after a level up", (record.data.spells || []).length, 0);
  assert("no Level Up lines for it", ctx.getSpellcastingLevelUpChanges(record, 3), []);
  record = synced(apply(record, { "data.spellcastingDismissed": [] }));
  assert("restored", record.data.spells.map((e) => e.name), ["Wizard Spells"]);
  assert("restore button hidden again", record.fields.restoreSpellcastingBtn.hidden, true);

  const cleric = synced(character(classRecord("Cleric"), 1, { spellcastingDismissed: ["class:cleric:font"] }));
  assert("only the dismissed one is skipped", cleric.data.spells.map((e) => e.name), ["Cleric Spells"]);

  // Losing the class: empty entries go, entries with spells stay unmanaged
  let wizard = synced(character(classRecord("Wizard"), 3));
  let emptied = synced(apply(wizard, { "data.classes": [] }));
  assert("an empty entry is removed with the class", (emptied.data.spells || []).length, 0);
  wizard = fillRow(wizard, "class:wizard", "spells1", 0, filled("Grease"));
  let kept = synced(apply(wizard, { "data.classes": [] }));
  const orphan = kept.data.spells[0];
  assert("an entry with spells is kept", kept.data.spells.length, 1);
  assert("and no longer managed", orphan.data.auto.orphaned, true);
  assert("its checkbox hides", orphan.fields.autoSlots.hidden, true);
  assert("its counts stay", orphan.data.numSpells2, 2);
  const back = synced(apply(kept, { "data.classes": [classRecord("Wizard")] }));
  assert("the class coming back takes it over again", back.data.spells.length, 1);
  assert("managed again", back.data.spells[0].data.auto.orphaned, false);
}

section("Training and DCs");
{
  let record = synced(character(classRecord("Wizard"), 7, { spellcasting: "2" }));
  assert("a managed entry has the character's rank", record.data.spells[0].data.training, 2);
  assert("DC from that rank", record.data.spells[0].data.dc, 10 + 4 + 4 + 7);

  // Review: a rank set by hand isn't lost on takeover (level 7 wizard set to
  // Master while the character's rank is Expert)
  const handSet = {
    name: "Arcane Prepared Spells",
    data: { type: "prepared", tradition: "Arcane", attribute: "int", training: "3", numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3, numSpells4: 2 },
    fields: {},
  };
  const master = synced(character(classRecord("Wizard"), 7, { spellcasting: "2", spells: [handSet] }));
  assert("taken over", master.data.spells[0].data.auto.source, "class:wizard");
  assert("a hand-set Master entry stays Master", master.data.spells[0].data.training, 3);
  assert("its DC uses Master", master.data.spells[0].data.dc, 10 + 4 + 6 + 7);
  assert("kept as the entry's own rank", master.data.spells[0].data.auto.ownTraining, 3);
  assert("then a sync writes nothing", spellKeys(syncValues(master)), []);
  const followed = synced(
    character(classRecord("Wizard"), 7, { spellcasting: "2", spells: [{ ...handSet, data: { ...handSet.data, training: 2 } }] }),
  );
  assert("an entry that had the character's rank keeps no rank of its own", followed.data.spells[0].data.auto.ownTraining, undefined);

  // Review: a rank picked in a managed entry's training dropdown sticks
  record = pickTraining(record, 0, "3");
  assert("picked Master", record.data.spells[0].data.training, 3);
  assert("DC from the picked rank", record.data.spells[0].data.dc, 10 + 4 + 6 + 7);
  record = synced(record);
  assert("a sync keeps the picked rank", record.data.spells[0].data.training, 3);
  assert("and its DC", record.data.spells[0].data.dc, 10 + 4 + 6 + 7);
  assert("no flip-flop: the next sync writes nothing", spellKeys(syncValues(record)), []);
  record = synced(apply(record, { "data.spells.0.data.autoSlots": false }));
  record = atLevel(record, 8);
  assert("Set slots from level off: still the picked rank", record.data.spells[0].data.training, 3);
  record = synced(apply(record, { "data.spells.0.data.autoSlots": true }));
  assert("back on: still the picked rank", record.data.spells[0].data.training, 3);
  record = synced(apply(record, { "data.spellcasting": "4" }));
  assert("a higher rank for the character wins", record.data.spells[0].data.training, 4);
  record = pickTraining(synced(apply(record, { "data.spellcasting": "2" })), 0, "1");
  assert("a pick below the character's rank gives the character's", record.data.spells[0].data.training, 2);

  // No ratchet: the entry follows the character's rank down
  let lowered = synced(character(classRecord("Wizard"), 7, { spellcasting: "2" }));
  lowered = synced(apply(lowered, { "data.level": 5, "data.spellcasting": "1" }));
  assert("follows the character's rank down", lowered.data.spells[0].data.training, 1);

  const unmanaged = character(null, 7, {
    spellcasting: "2",
    spells: [{ name: "Innate", data: { type: "innate", attribute: "cha", training: 3 }, fields: {} }],
  });
  const innate = synced(unmanaged).data.spells[0];
  assert("other entries keep their higher rank", innate.data.training, 3);
  assert("DC for it", innate.data.dc, 10 + 4 + 6 + 7);
  assert("and stay unmanaged", innate.data.auto, undefined);

  const item = character(null, 7, {
    spells: [{ name: "Wand", data: { type: "item", dc: 25, mod: 15 }, fields: {} }],
  });
  assert("item entries are not touched", spellKeys(syncValues(item)), []);
}

section("Writes: idempotent and structural");
{
  const cases = {
    "wizard with a school": character(classRecord("Wizard"), 5, { flags: { arcaneSchool: "school-of-battle-magic" } }),
    cleric: character(classRecord("Cleric"), 5),
    sorcerer: apply(sorcererWith(bloodline("Hag", "occult"), { bloodline: "bloodline-hag" }), { "data.level": 3 }),
    animist: character(classRecord("Animist"), 7),
    "legacy magus": character(classRecord("Magus", false), 7),
    "legacy summoner": character(classRecord("Summoner", false), 5),
  };
  for (const [name, start] of Object.entries(cases)) {
    const first = syncValues(start);
    assert(`${name}: creating writes only data.spells`, spellKeys(first), ["data.spells"]);
    const record = apply(start, first);
    assert(`${name}: a second sync writes nothing`, Object.keys(syncValues(record)), []);
  }

  // A level up that adds rows writes the whole list, nothing under it
  const wizard = synced(character(classRecord("Wizard"), 2));
  const levelUp = syncValues(apply(wizard, { "data.level": 3 }));
  assert("rows added: only data.spells", spellKeys(levelUp), ["data.spells"]);

  // A change without new rows writes single fields
  const smarter = syncValues(apply(wizard, { "data.int": 5 }));
  assertNotIncludes("attribute change: not the whole list", spellKeys(smarter), "data.spells");
  assert("attribute change: Mod and DC only", spellKeys(smarter), ["data.spells.0.data.dc", "data.spells.0.data.mod"]);

  // A slot count changing while the rows stay (a full repertoire can't shrink)
  let sorcerer = synced(
    apply(sorcererWith(bloodline("Fey", "primal"), { bloodline: "bloodline-fey" }), { "data.level": 2 }),
  );
  sorcerer = apply(sorcerer, {
    "data.spells.0.data.spells1": ["Fear", "Grease", "Sleep", "Charm"].map((name) => filled(name)),
  });
  const perField = syncValues(apply(sorcerer, { "data.level": 1 }));
  assert(
    "count change: single fields",
    spellKeys(perField).sort(),
    [
      "data.spells.0.data.auto.base.numSpells1",
      "data.spells.0.data.auto.base.rep1",
      "data.spells.0.data.dc",
      "data.spells.0.data.mod",
      "data.spells.0.data.numSpells1",
      "data.spells.0.data.usedSpells1",
    ],
  );
  assert("slots left drop with the count", perField["data.spells.0.data.usedSpells1"], 3);
  assertNotIncludes("no whole-list write", spellKeys(perField), "data.spells");

  // Turn start: nothing changed, nothing written
  const npc = { _id: "npc", recordType: "npcs", data: { level: 5, spells: [{ data: { type: "prepared" } }] } };
  const npcValues = {};
  assert("NPCs: no sync", ctx.syncSpellcastingEntries(npc, npcValues), null);
  ctx.updateSpellcastingEntries(npc, npcValues, null);
  assert("NPCs: nothing written", npcValues, {});
}

section("onAddEditFeature");
{
  let written = null;
  const original = ctx.api.setValuesOnRecord;
  ctx.api.setValuesOnRecord = (record, values) => {
    written = values;
  };
  const wizardClass = classRecord("Wizard", true, { spellcasting: "1", keyAbility: ["int"] });
  const pc = character(wizardClass, 3, { keyAbility: "int", int: undefined, flags: { arcaneSchool: "school-of-mentalism" } });
  ctx.onAddEditFeature(pc, undefined, true);
  const entry = written["data.spells"][0];
  assert("entries written in the same update", spellKeys(written), ["data.spells"]);
  assert("sized for 3rd level with a school", [entry.data.numCantrips, entry.data.numSpells1, entry.data.numSpells2], [6, 4, 3]);
  assert("DC uses the recalculated Intelligence", entry.data.mod, written["data.int"] + 2 + 3);
  ctx.onAddEditFeature(apply(pc, written), undefined, true);
  assert("the next run writes no spellcasting fields", spellKeys(written), []);
  ctx.api.setValuesOnRecord = original;
}

section("Level 0 characters");
{
  const levelZero = character(ctx.buildLevelZeroClass(), 0);
  const values = syncValues(levelZero);
  assert("level 0: no entries", spellKeys(values), []);
  assert("level 0: no specs", ctx.getWantedSpellcastingEntries(levelZero, 0), []);
  assert("level 0 with a class: no entries", spellKeys(syncValues(character(classRecord("Wizard"), 0))), []);
}

section("Level Up summary");
{
  const wizard = synced(character(classRecord("Wizard"), 2, { flags: { arcaneSchool: "school-of-battle-magic" } }));
  assert("new rank", ctx.getSpellcastingLevelUpChanges(wizard, 3), ["Wizard Spells: 2nd-rank spells (3 slots)"]);
  assert("more slots", ctx.getSpellcastingLevelUpChanges(atLevel(wizard, 3), 4), ["Wizard Spells: +1 2nd-rank slot"]);

  const sorcerer = synced(sorcererWith(bloodline("Fey", "primal"), { bloodline: "bloodline-fey" }));
  assert("spontaneous", ctx.getSpellcastingLevelUpChanges(sorcerer, 2), ["Sorcerer Spells: +1 1st-rank slot, learn 1 spell"]);

  const cleric = character(classRecord("Cleric"), 4);
  assert(
    "cleric at 5th",
    ctx.getSpellcastingLevelUpChanges(cleric, 5),
    ["Cleric Spells: 3rd-rank spells (2 slots)", "Divine Font moves to 3rd rank (5 slots)"],
  );
  assert("cleric at 19th: font stays at 9th", ctx.getSpellcastingLevelUpChanges(character(classRecord("Cleric"), 18), 19), ["Cleric Spells: 10th-rank spells (1 slot)"]);

  const magus = character(classRecord("Magus", false), 4);
  assert(
    "bounded",
    ctx.getSpellcastingLevelUpChanges(magus, 5),
    ["Magus Spells: no more 1st-rank slots, 3rd-rank spells (2 slots)"],
  );

  const gains = ctx.getLevelUpGains(cleric, 5);
  const text = ctx.getLevelUpSummary(gains);
  assert("summary lists the font", text.includes("Divine Font moves to 3rd rank (5 slots)"), true);
  assert("fighter: no spell lines", ctx.getLevelUpGains(character(classRecord("Fighter"), 1), 2).spellcasting, []);
}

section("Entry builders and spells.js fixes");
{
  let added = null;
  const pc = character(null, 5, {
    spellcasting: "2",
    addType: "spontaneous",
    addTradition: "Occult",
    addAttribute: "cha",
    spells: [],
  });
  ctx.api.getRecord = (type, id, callback) => callback(pc);
  ctx.api.addValue = (path, value) => {
    added = { path, value };
  };
  ctx.addSpellcastingEntry(pc);
  assert("Add Spellcasting Entry saves the character's rank", added.value.data.training, 2);
  assert("and gives the entry an id", typeof added.value._id, "string");
  assert("default name", added.value.name, "Occult Spontaneous Spells");
  assert("DC from the rank", added.value.data.dc, 10 + 4 + 4 + 5);
  assert("spontaneous fields", added.value.fields.spontaneousBox.hidden, false);
  assert("first entry", added.value.fields.moveUpBtn.hidden, true);

  let written = null;
  ctx.api.setValues = (values) => {
    written = values;
  };
  const prepared = {
    name: "Ezren's Spellbook",
    data: {
      type: "prepared",
      tradition: "Divine",
      numSpells1: 2,
      spells1: [{ ...filled("Bless", { used: true }), fields: { nameUsedBox: { hidden: false }, nameBox: { hidden: true } } }],
    },
  };
  ctx.updateSpellcastingEntry(pc, JSON.parse(JSON.stringify(prepared)), "data.spells.0");
  assert("a custom name is kept", written["data.spells.0.name"], undefined);
  assert("a cast spell stays cast", written["data.spells.0.data.spells1"][0].data.used, true);
  assert("an empty slot is added", written["data.spells.0.data.spells1"][1].name, "Rank 1 Spell Slot");
  ctx.updateSpellcastingEntry(pc, JSON.parse(JSON.stringify(prepared)), "data.spells.0", true);
  assert("changing the type readies it", written["data.spells.0.data.spells1"][0].data.used, false);
  assert("and clears the strikethrough", written["data.spells.0.data.spells1"][0].fields.nameUsedBox.hidden, true);
  ctx.updateSpellcastingEntry(pc, { ...JSON.parse(JSON.stringify(prepared)), name: "Arcane Prepared Spells" }, "data.spells.0");
  assert("a default name follows the settings", written["data.spells.0.name"], "Divine Prepared Spells");
  assert("default names", [ctx.isDefaultSpellcastingEntryName("Occult Focus Spells"), ctx.isDefaultSpellcastingEntryName("Wizard Spells")], [true, false]);
  ctx.api.setValues = () => {};
}

section("Review: the takeover picks the class's entry, not an archetype's");
{
  // Level 6 wizard: the spellbook and a default-named archetype entry
  // (2 cantrips, one 1st-rank slot)
  const spellbook = playerEntry("Ezren's Spellbook", {
    numCantrips: 5,
    numSpells1: 3,
    numSpells2: 3,
    numSpells3: 3,
    spells1: preparedRows(1, 3, ["Force Barrage"]),
  });
  const archetype = playerEntry("Arcane Prepared Spells", {
    numCantrips: 2,
    numSpells1: 1,
    cantrips: preparedRows(0, 2, ["Shield", "Detect Magic"]),
    spells1: preparedRows(1, 1),
  });
  for (const [order, spells] of [
    ["archetype listed first", [archetype, spellbook]],
    ["spellbook listed first", [spellbook, archetype]],
  ]) {
    const record = synced(character(classRecord("Wizard"), 6, { spells }));
    const book = record.data.spells.find((entry) => entry.name === "Ezren's Spellbook");
    const other = record.data.spells.find((entry) => entry.name === "Arcane Prepared Spells");
    assert(`wizard, ${order}: no entry added`, record.data.spells.length, 2);
    assert(`wizard, ${order}: the spellbook is taken over`, book.data.auto?.source, "class:wizard");
    assert(`wizard, ${order}: the archetype entry is left alone`, other.data.auto, undefined);
    assert(`wizard, ${order}: and keeps its counts`, [other.data.numCantrips, other.data.numSpells1], [2, 1]);
    assert(`wizard, ${order}: and its rows`, [other.data.cantrips.length, other.data.spells1.length], [2, 1]);
  }

  // Sorcerer with "Sorcery" and a Bard Dedication entry named by the popover
  const sorcery = playerEntry("Sorcery", {
    type: "spontaneous",
    tradition: "Occult",
    attribute: "cha",
    numSpells1: 4,
    numSpells2: 4,
    usedSpells1: 4,
    usedSpells2: 2,
    cantrips: ["Daze", "Shield", "Message", "Prestidigitation", "Detect Magic"].map((name) => filled(name, { level: 0 })),
    spells1: ["Fear", "Sleep", "Charm", "Soothe"].map((name) => filled(name)),
    spells2: ["Blur", "Paranoia", "Dispel Magic", "Mirror Image"].map((name) => filled(name, { level: 2 })),
  });
  const bard = playerEntry("Occult Spontaneous Spells", {
    type: "spontaneous",
    tradition: "Occult",
    attribute: "cha",
    numSpells1: 1,
    usedSpells1: 1,
    cantrips: ["Figment", "Telekinetic Hand"].map((name) => filled(name, { level: 0 })),
    spells1: [filled("Bless")],
  });
  for (const [order, spells] of [
    ["dedication listed first", [bard, sorcery]],
    ["Sorcery listed first", [sorcery, bard]],
  ]) {
    const start = apply(sorcererWith(bloodline("Aberrant", "occult"), { bloodline: "bloodline-aberrant" }), {
      "data.level": 4,
      "data.spells": spells,
    });
    const record = synced(start);
    const own = record.data.spells.find((entry) => entry.name === "Sorcery");
    const other = record.data.spells.find((entry) => entry.name === "Occult Spontaneous Spells");
    assert(`sorcerer, ${order}: Sorcery is taken over`, own.data.auto?.source, "class:sorcerer");
    assert(`sorcerer, ${order}: the dedication entry is left alone`, other.data.auto, undefined);
    assert(`sorcerer, ${order}: no slots added to it`, [other.data.numSpells1, other.data.numSpells2], [1, undefined]);
    assert(`sorcerer, ${order}: no placeholder rows added to it`, [other.data.spells1.length, other.data.spells2], [1, undefined]);
  }

  // An archetype's entry on its own isn't taken over either: its few slots
  // tell it apart
  const archetypeOnly = synced(character(classRecord("Wizard"), 6, { spells: [archetype] }));
  assert("archetype entry alone: not taken", sources(archetypeOnly), [null, "class:wizard"]);
  assert("archetype entry alone: its counts stay", [archetypeOnly.data.spells[0].data.numCantrips, archetypeOnly.data.spells[0].data.numSpells1], [2, 1]);
  const bardOnly = synced(
    apply(sorcererWith(bloodline("Aberrant", "occult"), { bloodline: "bloodline-aberrant" }), {
      "data.level": 4,
      "data.spells": [bard],
    }),
  );
  assert("dedication entry alone: not taken", sources(bardOnly), [null, "class:sorcerer"]);
  assert("dedication entry alone: no placeholders added", bardOnly.data.spells[0].data.spells1.length, 1);

  // The popover's default names count for nothing: the entry closest to the
  // table wins
  const close = synced(
    character(classRecord("Wizard"), 6, {
      spells: [
        playerEntry("Arcane Prepared Spells", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 1 }),
        playerEntry("Spellbook", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3 }),
      ],
    }),
  );
  assert("a default name doesn't beat a closer entry", sources(close), [null, "class:wizard"]);
  const named = synced(
    character(classRecord("Wizard"), 6, {
      spells: [
        playerEntry("Spellbook", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3 }),
        playerEntry("Wizard's Grimoire", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 1 }),
      ],
    }),
  );
  assert("a name with the class wins before closeness", sources(named), [null, "class:wizard"]);

  // An entry named for another class is an archetype's
  const bardSpells = playerEntry("Bard Spells", { type: "spontaneous", tradition: "Occult", attribute: "cha", numSpells1: 4 });
  const sorcerer2 = (spells) =>
    apply(sorcererWith(bloodline("Aberrant", "occult"), { bloodline: "bloodline-aberrant" }), {
      "data.level": 2,
      "data.spells": spells,
    });
  const bardDedication = playerEntry("Bard Spells", { type: "spontaneous", tradition: "Occult", attribute: "cha", numCantrips: 2 });
  const notTaken = synced(sorcerer2([bardDedication]));
  assert("an entry named for another class isn't taken", sources(notTaken), [null, "class:sorcerer"]);
  assert("so the class's entry is added", names(notTaken), ["Bard Spells", "Sorcerer Spells"]);
  assert("named for another class but holding the class's slots, it is taken", sources(synced(sorcerer2([bardSpells]))), ["class:sorcerer"]);
  const bardolph = synced(sorcerer2([{ ...bardSpells, name: "Bardolph's Spells" }]));
  assert("a name that only starts like a class is fine", sources(bardolph), ["class:sorcerer"]);

  // Entries that tie: none is taken over or added, and the notice says so
  const tieEntries = [
    playerEntry("Spellbook", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3 }),
    playerEntry("Battle Book", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3 }),
  ];
  const tieStart = character(classRecord("Wizard"), 6, { spells: tieEntries });
  let tie = synced(tieStart);
  assert("a tie: neither is taken", sources(tie), [null, null]);
  assert("and no entry is added", tie.data.spells.length, 2);
  assert("Restore Automatic Entries shows", tie.fields.restoreSpellcastingBtn.hidden, false);
  assert(
    "the notice names them",
    ctx.describeSpellcastingSync(tieEntries, tie),
    'Spellbook and Battle Book could each be the class entry "Wizard Spells", so none was taken over or added. Add "Wizard" to the name of the one to use, then click Restore Automatic Entries (under Add Spellcasting Entry).',
  );
  tie = synced(apply(tie, { "data.spells.1.name": "Wizard's Battle Book" }));
  assert("named for the class, it is taken over", sources(tie), [null, "class:wizard"]);
  assert("and the button hides", tie.fields.restoreSpellcastingBtn.hidden, true);
  const namedTie = synced(
    apply(tieStart, { "data.spells.0.name": "Wizard Spellbook", "data.spells.1.name": "Wizard Battle Book" }),
  );
  assert("both named for the class and tied: neither is taken", sources(namedTie), [null, null]);
  assert(
    "the notice asks to keep the class in one name only",
    ctx.describeSpellcastingSync(namedTie.data.spells, namedTie).includes(
      'Keep "Wizard" in the name of only the one to use, then click Restore Automatic Entries',
    ),
    true,
  );

  // Unknown tradition and two entries of the type: the notice says so too
  const unknown = sorcererWith(null, { bloodline: "bloodline-draconic" });
  unknown.data.spells = [
    playerEntry("Arcane Spontaneous Spells", { type: "spontaneous" }),
    playerEntry("Occult Spontaneous Spells", { type: "spontaneous", tradition: "Occult" }),
  ];
  const unknownSynced = synced(unknown);
  assert(
    "unknown tradition: the notice names both",
    ctx.describeSpellcastingSync(unknown.data.spells, unknownSynced).startsWith(
      'Arcane Spontaneous Spells and Occult Spontaneous Spells could each be the class entry "Sorcerer Spells"',
    ),
    true,
  );

  // A side entry named for the class (a staff, scrolls, a cleric's heal
  // slots) holds few of its slots: while another entry holds the class's,
  // that one is taken over, even under the popover's name, and the side
  // entry is left as it was
  const book = playerEntry("Arcane Prepared Spells", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3 });
  const sideEntries = [
    {
      label: "wizard's staff",
      build: (spells) => character(classRecord("Wizard"), 6, { spells }),
      main: book,
      side: playerEntry("Wizard's Staff", {
        numSpells1: 1,
        numSpells2: 1,
        numSpells3: 1,
        spells1: preparedRows(1, 1, ["Force Barrage"]),
        spells2: preparedRows(2, 1, ["Mist"]),
        spells3: preparedRows(3, 1, ["Fireball"]),
      }),
      source: "class:wizard",
    },
    {
      label: "wizard scrolls",
      build: (spells) => character(classRecord("Wizard"), 6, { spells }),
      main: book,
      side: playerEntry("Wizard Scrolls", { numSpells1: 2, numSpells2: 1, spells1: preparedRows(1, 2, ["Sleep", "Fear"]) }),
      source: "class:wizard",
    },
    {
      label: "cleric heal slots",
      build: (spells) => character(classRecord("Cleric"), 5, { spells }),
      main: playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 2 }),
      side: playerEntry("Cleric Heal Slots", { tradition: "Divine", attribute: "wis", numSpells3: 4, spells3: preparedRows(3, 4, ["Heal", "Heal", "Heal", "Heal"]) }),
      source: "class:cleric",
    },
  ];
  for (const { label, build, main, side, source } of sideEntries) {
    for (const [order, spells] of [
      ["side entry listed first", [side, main]],
      ["class's entry listed first", [main, side]],
    ]) {
      const record = synced(build(spells));
      const own = record.data.spells.find((entry) => entry.name === main.name);
      const other = record.data.spells.find((entry) => entry.name === side.name);
      assert(`${label}, ${order}: the class's entry is taken over`, own.data.auto?.source, source);
      assert(`${label}, ${order}: the side entry is left as it was`, [other.data.auto, other.data.numCantrips, counts(other)], [undefined, side.data.numCantrips, counts(side)]);
      assert(
        `${label}, ${order}: the notice names the class's entry`,
        ctx.describeSpellcastingSync(spells, record).startsWith(`${main.name} now follow your level`),
        true,
      );
    }
  }
  const heal = sideEntries[2];
  assert(
    "cleric heal slots: the notice names them next to the new Divine Font",
    ctx.describeSpellcastingSync([heal.main, heal.side], synced(heal.build([heal.main, heal.side]))).includes(
      "Cleric Heal Slots, left as it was, holds 4 3rd-rank slots.",
    ),
    true,
  );
  const customBook = synced(
    character(classRecord("Wizard"), 6, {
      spells: [sideEntries[1].side, playerEntry("Spellbook", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3 })],
    }),
  );
  assert("a custom-named spellbook beats a class-named side entry", sources(customBook), [null, "class:wizard"]);

  // Alone, or next to an archetype's entry, an entry named for the class is
  // still the class's, however few slots it holds
  const fewSlots = playerEntry("Wizard Spells", { numSpells1: 2, spells1: preparedRows(1, 2, ["Sleep"]) });
  assert("a lone class-named entry with few slots is taken over", sources(synced(character(classRecord("Wizard"), 2, { spells: [fewSlots] }))), ["class:wizard"]);
  const withArchetype = synced(
    character(classRecord("Wizard"), 2, {
      spells: [playerEntry("Arcane Prepared Spells", { numCantrips: 2, numSpells1: 1 }), fewSlots],
    }),
  );
  assert("and next to an archetype's entry", sources(withArchetype), [null, "class:wizard"]);
}

section("Review: an entry of another tradition is taken over, not duplicated");
{
  // A level 3 cleric whose entry kept the popover's "Arcane"
  const arcane = playerEntry("Arcane Prepared Spells", { attribute: "wis", numCantrips: 5, numSpells1: 3, numSpells2: 2 });
  const record = synced(character(classRecord("Cleric"), 3, { spells: [arcane] }));
  assert("no second class entry, plus the font", names(record), ["Arcane Prepared Spells", "Divine Font"]);
  assert("the player's entry is the class's", sources(record), ["class:cleric", "class:cleric:font"]);
  assert("the player's tradition is kept", record.data.spells[0].data.tradition, "Arcane");
  assert("counts unchanged", counts(record.data.spells[0]), { 1: 3, 2: 2 });
  assert("a second sync writes nothing", spellKeys(syncValues(record)), []);
  assert(
    "the notice says the tradition was kept",
    ctx.describeSpellcastingSync([arcane], record),
    'Arcane Prepared Spells now follow your level (higher counts kept). To stop this, uncheck "Set slots from level" in its settings. Arcane Prepared Spells kept its Arcane tradition. Your class casts divine spells, so change it in its settings if that was a mistake. Added from your class: Divine Font.',
  );

  // An entry with no tradition stored takes the class's
  const none = playerEntry("Cleric Prayers", { tradition: undefined, numCantrips: 5, numSpells1: 3, numSpells2: 2 });
  const noTradition = synced(character(classRecord("Cleric"), 3, { spells: [none] }));
  assert("no tradition: taken over", sources(noTradition), ["class:cleric", "class:cleric:font"]);
  assert("and given the class's", noTradition.data.spells[0].data.tradition, "Divine");

  // An archetype's entry next to it doesn't count as a second candidate
  const withDruid = synced(
    character(classRecord("Cleric"), 5, {
      spells: [
        playerEntry("Arcane Prepared Spells", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 2 }),
        playerEntry("Primal Prepared Spells", { tradition: "Primal", numCantrips: 2, numSpells1: 1 }),
      ],
    }),
  );
  assert("next to an archetype's entry: still taken over", sources(withDruid), ["class:cleric", null, "class:cleric:font"]);

  // Two entries, neither of the class's tradition: none taken, none added
  const two = synced(
    character(classRecord("Cleric"), 3, {
      spells: [
        playerEntry("Arcane Prepared Spells", { numCantrips: 5, numSpells1: 3, numSpells2: 2 }),
        playerEntry("Primal Prepared Spells", { tradition: "Primal", numCantrips: 5, numSpells1: 3, numSpells2: 2 }),
      ],
    }),
  );
  assert("two of other traditions: neither taken, none added", sources(two), [null, null, "class:cleric:font"]);
}

section("Review: archetype entries next to classes with 1 or 2 slots a rank");
{
  // Level 8 psychic whose entry kept the popover's "Arcane", and a Bard
  // Dedication entry with Basic Bard Spellcasting and Occult Breadth (1st 2,
  // 2nd 1, 3rd 1): half the psychic's slots, so not under half
  const psychic = playerEntry("Arcane Spontaneous Spells", {
    type: "spontaneous",
    numSpells1: 2,
    numSpells2: 2,
    numSpells3: 2,
    numSpells4: 2,
    cantrips: ["Daze", "Message", "Shield", "Imaginary Weapon", "Ghostly Shift", "Forbidden Thought"].map((name) => filled(name, { level: 0 })),
    spells1: ["Fear", "Sleep", "Command"].map((name) => filled(name)),
  });
  const bard = playerEntry("Occult Spontaneous Spells", {
    type: "spontaneous",
    tradition: "Occult",
    attribute: "cha",
    numSpells1: 2,
    numSpells2: 1,
    numSpells3: 1,
    cantrips: ["Figment", "Telekinetic Hand"].map((name) => filled(name, { level: 0 })),
    spells1: [filled("Soothe"), filled("Bless")],
    spells2: [filled("Calm", { level: 2 })],
    spells3: [filled("Heroism", { level: 3 })],
  });
  for (const [order, spells] of [
    ["psychic's entry first", [psychic, bard]],
    ["dedication's entry first", [bard, psychic]],
  ]) {
    const record = synced(character(classRecord("Psychic"), 8, { keyAbility: "int", spells }));
    const own = record.data.spells.find((entry) => entry.name === "Arcane Spontaneous Spells");
    const other = record.data.spells.find((entry) => entry.name === "Occult Spontaneous Spells");
    assert(`psychic, ${order}: no entry added`, record.data.spells.length, 2);
    assert(`psychic, ${order}: its own entry is taken over`, own.data.auto?.source, "class:psychic");
    assert(`psychic, ${order}: the dedication's is left as it was`, [other.data.auto, counts(other)], [undefined, { 1: 2, 2: 1, 3: 1 }]);
    assert(`psychic, ${order}: no rows added to it`, [other.data.cantrips.length, other.data.spells2.length, other.data.spells4], [2, 1, undefined]);
  }

  // Level 4 animist with its apparition slots folded into its one entry, and
  // a Bard Dedication entry with one 1st-rank slot: the Bard's isn't taken as
  // the apparition entry, as the only spontaneous one
  const animist = playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", numCantrips: 4, numSpells1: 3, numSpells2: 3 });
  const bardSlot = playerEntry("Occult Spontaneous Spells", {
    type: "spontaneous",
    tradition: "Occult",
    attribute: "cha",
    numSpells1: 1,
    cantrips: ["Figment", "Telekinetic Hand"].map((name) => filled(name, { level: 0 })),
    spells1: [filled("Soothe")],
  });
  for (const [order, spells] of [
    ["animist's entry first", [animist, bardSlot]],
    ["dedication's entry first", [bardSlot, animist]],
  ]) {
    const record = synced(character(classRecord("Animist"), 4, { spells }));
    const other = record.data.spells.find((entry) => entry.name === "Occult Spontaneous Spells");
    assert(`animist, ${order}: the dedication's entry is left as it was`, [other.data.auto, counts(other), other.data.spells1.length, other.data.spells2], [undefined, { 1: 1 }, 1, undefined]);
    assert(
      `animist, ${order}: the notice doesn't ask to make it divine`,
      ctx.describeSpellcastingSync(spells, record).includes("kept its Occult tradition"),
      false,
    );
  }

  // Every caster from 4th level: an archetype's entry (with a Breadth feat
  // from 8th) is told apart from the class's, and the class's own entry, at
  // this level's table or the last level's, isn't taken for one
  const archetypeEntry = (type, level) => {
    const data = { type };
    if (type === "prepared") data.numCantrips = 2;
    const ranks = [[1, 4], [2, 6], [3, 8], [4, 12], [5, 14], [6, 16], [7, 18], [8, 20]]
      .filter(([, at]) => level >= at)
      .map(([rank]) => rank);
    ranks.forEach((rank, i) => {
      data[`numSpells${rank}`] = level >= 8 && i < ranks.length - 2 ? 2 : 1;
    });
    return playerEntry("Occult Spells", data);
  };
  const missed = [];
  for (const [name, remaster] of [
    ["Wizard", true], ["Cleric", true], ["Druid", true], ["Witch", true], ["Bard", true], ["Sorcerer", true],
    ["Oracle", true], ["Oracle", false], ["Psychic", true], ["Animist", true], ["Necromancer", true],
    ["Magus", true], ["Magus", false], ["Summoner", true], ["Summoner", false],
  ]) {
    const specsAt = (level) => ctx.getWantedSpellcastingEntries(character(classRecord(name, remaster), level), level);
    for (let level = 4; level <= 20; level++) {
      for (const spec of specsAt(level).filter((s) => !s.fontRank)) {
        if (!ctx.isArchetypeSpellcastingEntry(archetypeEntry(spec.type, level), spec)) {
          missed.push(`${spec.source} at ${level}: an archetype's entry taken for the class's`);
        }
        for (const at of [level, level - 1]) {
          const own = specsAt(at).find((s) => s.source === spec.source);
          if (ctx.isArchetypeSpellcastingEntry(playerEntry("Spells", { type: spec.type, ...own.counts }), spec)) {
            missed.push(`${spec.source} at ${level}: the table of ${at} taken for an archetype's`);
          }
        }
      }
    }
  }
  assert("archetype entries told apart for every caster", missed, []);
}

section("Review: Divine Font slots folded into the class's entry");
{
  // Level 5 cleric with 3rd rank 7 (2 from the class, 5 from the font), heal
  // prepared in five of them
  const folded = playerEntry("Divine Prepared Spells", {
    tradition: "Divine",
    attribute: "wis",
    numCantrips: 5,
    numSpells1: 3,
    numSpells2: 3,
    numSpells3: 7,
    spells3: preparedRows(3, 7, ["Holy Light", "Heal", "Heal", "Heal", "Heal", "Heal"]),
  });
  const record = synced(character(classRecord("Cleric"), 5, { spells: [folded] }));
  const main = entryFor(record, "class:cleric");
  const font = entryFor(record, "class:cleric:font");
  assert("the class entry drops the font's 5", main.data.numSpells3, 2);
  assert("the font entry has them", font.data.numSpells3, 5);
  assert("7 3rd-rank slots in all, not 12", main.data.numSpells3 + font.data.numSpells3, 7);
  assert("the heal spells move with them", font.data.spells3.map((row) => row.name), ["Heal", "Heal", "Heal", "Heal", "Heal"]);
  assert("the class entry keeps its own spell and slot", main.data.spells3.map((row) => row.name), ["Holy Light", "Rank 3 Spell Slot"]);
  assert("a second sync writes nothing", spellKeys(syncValues(record)), []);
  assert(
    "the notice says so",
    ctx.describeSpellcastingSync([folded], record),
    'Divine Prepared Spells now follow your level (higher counts kept). To stop this, uncheck "Set slots from level" in its settings. 5 Divine Font slots in Divine Prepared Spells moved to the new Divine Font entry. Added from your class: Divine Font.',
  );

  // An extra that isn't the font's count is kept, and the notice names it
  const six = playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 6 });
  const kept = synced(character(classRecord("Cleric"), 5, { spells: [six] }));
  assert("another extra is kept", entryFor(kept, "class:cleric").data.numSpells3, 6);
  assert(
    "and named in the notice",
    ctx.describeSpellcastingSync([six], kept).includes(
      "Divine Prepared Spells kept 4 3rd-rank slots over your class's. If these are Divine Font slots, lower the count: Divine Font has its own entry now.",
    ),
    true,
  );

  // Font slots left at the rank of a lower level are named too
  const stale = playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", numCantrips: 5, numSpells1: 3, numSpells2: 7, numSpells3: 2 });
  const staleSynced = synced(character(classRecord("Cleric"), 5, { spells: [stale] }));
  assert("font slots at an old rank are kept", entryFor(staleSynced, "class:cleric").data.numSpells2, 7);
  assert(
    "and named in the notice",
    ctx.describeSpellcastingSync([stale], staleSynced).includes("Divine Prepared Spells kept 4 2nd-rank slots over your class's."),
    true,
  );

  // With a Divine Font entry of its own, an extra in the class's entry stays
  const both = synced(
    character(classRecord("Cleric"), 5, {
      spells: [
        { ...folded, data: { ...folded.data, spells3: undefined } },
        playerEntry("Divine Font", { tradition: "Divine", attribute: "wis", numSpells3: 5 }),
      ],
    }),
  );
  assert("an existing font entry: the class's extra stays", entryFor(both, "class:cleric").data.numSpells3, 7);
  assert("and the font entry is taken over", entryFor(both, "class:cleric:font").name, "Divine Font");

  // The class's entry set to Expert by hand (the character is Trained): the
  // new Divine Font entry gets that rank too, so the heal spells moved to it
  // keep their DC, and so does an animist's new apparition entry
  const expert = playerEntry("Divine Prepared Spells", { ...folded.data, training: "2" });
  const ranked = synced(character(classRecord("Cleric"), 5, { spells: [expert] }));
  const rankedFont = entryFor(ranked, "class:cleric:font");
  assert("the class's entry keeps its rank", entryFor(ranked, "class:cleric").data.training, 2);
  assert("the new font entry has it too", rankedFont.data.training, 2);
  assert("and the same DC", rankedFont.data.dc, entryFor(ranked, "class:cleric").data.dc);
  assert("with the heal spells", rankedFont.data.spells3.map((row) => row.name), ["Heal", "Heal", "Heal", "Heal", "Heal"]);
  assert("then a sync writes nothing", spellKeys(syncValues(ranked)), []);
  const animist = synced(
    character(classRecord("Animist"), 7, {
      spells: [
        playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", training: "2", numCantrips: 2, numSpells1: 2, numSpells2: 2, numSpells3: 2, numSpells4: 1 }),
      ],
    }),
  );
  assert("the animist's new apparition entry has it too", entryFor(animist, "class:animist:apparition").data.training, 2);
  const trained = synced(character(classRecord("Cleric"), 5, { spells: [folded] }));
  assert("a class's entry at the character's rank: the font's follows the character", entryFor(trained, "class:cleric:font").data.auto.ownTraining, undefined);

  // A class's entry with "font" in its name is still the class's: it has the
  // class's cantrips, which the font never gives
  const fontNamed = playerEntry("Cleric Spells + Font", {
    ...folded.data,
    cantrips: preparedRows(0, 5, ["Guidance"]),
    spells1: preparedRows(1, 3, ["Bless", "Command"]),
    spells2: preparedRows(2, 3, ["Calm"]),
  });
  const fontNamedSynced = synced(character(classRecord("Cleric"), 5, { spells: [fontNamed] }));
  assert("a font-named class entry: the class's, and the font added", sources(fontNamedSynced), ["class:cleric", "class:cleric:font"]);
  assert("it keeps the class's counts", counts(entryFor(fontNamedSynced, "class:cleric")), { 1: 3, 2: 3, 3: 2 });
  assert("its spells stay at their ranks", entryFor(fontNamedSynced, "class:cleric").data.spells1.map((row) => row.name), ["Bless", "Command", "Rank 1 Spell Slot"]);
  assert("the font's 5 slots move to the Divine Font", entryFor(fontNamedSynced, "class:cleric:font").data.spells3.map((row) => row.name), ["Heal", "Heal", "Heal", "Heal", "Heal"]);
  const fontaine = synced(
    character(classRecord("Cleric"), 5, {
      spells: [playerEntry("Fontaine's Prayers", { tradition: "Divine", attribute: "wis", numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 2 })],
    }),
  );
  assert("a name only containing 'font': the class's", sources(fontaine), ["class:cleric", "class:cleric:font"]);
  assert("and its counts stay", counts(fontaine.data.spells[0]), { 1: 3, 2: 3, 3: 2 });
}

section("Review: a Divine Font kept in its own entry is taken over, whatever its name");
{
  // A level 5 cleric with the class's entry and the font's, both under the
  // popover's name: the sheet used to rename an entry whenever its counts
  // changed, as the font's do at every odd level
  const classEntry = (data = {}) =>
    playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 2, ...data });
  const fontEntry = (name = "Divine Prepared Spells", data = {}) =>
    playerEntry(name, {
      tradition: "Divine",
      attribute: "wis",
      numSpells3: 5,
      spells3: preparedRows(3, 5, ["Heal", "Heal", "Heal", "Heal", "Heal"]),
      ...data,
    });
  const total = (record, rank) =>
    record.data.spells.reduce((sum, entry) => sum + (parseInt(entry.data[`numSpells${rank}`] || 0, 10) || 0), 0);
  const heals = (entry, rank) => (entry.data[`spells${rank}`] || []).filter((row) => row.name === "Heal").length;

  for (const [order, spells] of [
    ["class's entry first", [classEntry(), fontEntry()]],
    ["font's entry first", [fontEntry(), classEntry()]],
  ]) {
    const record = synced(character(classRecord("Cleric"), 5, { spells }));
    const font = entryFor(record, "class:cleric:font");
    assert(`${order}: no entry added`, record.data.spells.length, 2);
    assert(`${order}: the class's entry`, counts(entryFor(record, "class:cleric")), { 1: 3, 2: 3, 3: 2 });
    assert(`${order}: the font's entry is the Divine Font`, [font.name, counts(font)], ["Divine Font", { 3: 5 }]);
    assert(`${order}: its heal spells stay`, heals(font, 3), 5);
    assert(`${order}: 7 3rd-rank slots in all, not 12`, total(record, 3), 7);
    assert(`${order}: a second sync writes nothing`, spellKeys(syncValues(record)), []);
  }
  const before = [classEntry(), fontEntry()];
  const record = synced(character(classRecord("Cleric"), 5, { spells: before }));
  assert(
    "the notice names both",
    ctx.describeSpellcastingSync(before, record),
    'Divine Prepared Spells and Divine Font now follow your level (higher counts kept). To stop this, uncheck "Set slots from level" in each one\'s settings.',
  );
  const at7 = atLevel(record, 7);
  assert("at 7th the font moves to 4th rank", counts(entryFor(at7, "class:cleric:font")), { 4: 5 });
  assert("with its heal spells", heals(entryFor(at7, "class:cleric:font"), 4), 5);
  assert("and no font slots stay at 3rd rank", total(at7, 3), 3);

  // The same at every level, in both editions (the legacy font is 1 +
  // Charisma)
  const missed = [];
  for (const remaster of [true, false]) {
    for (let level = 1; level <= 20; level++) {
      const start = character(classRecord("Cleric", remaster), level);
      const [classSpec, fontSpec] = ctx.getWantedSpellcastingEntries(start, level);
      const rank = fontSpec.fontRank;
      const fontCount = fontSpec.counts[`numSpells${rank}`];
      const leveled = synced(
        apply(start, {
          "data.spells": [
            playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", ...classSpec.counts }),
            playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", ...fontSpec.counts, [`spells${rank}`]: preparedRows(rank, fontCount, ["Heal"]) }),
          ],
        }),
      );
      const label = `${remaster ? "" : "legacy, "}level ${level}`;
      if (sources(leveled).join() !== "class:cleric,class:cleric:font") missed.push(`${label}: ${sources(leveled).join()}`);
      if (total(leveled, rank) !== classSpec.counts[`numSpells${rank}`] + fontCount) missed.push(`${label}: ${total(leveled, rank)} at rank ${rank}`);
    }
  }
  assert("at every level, in both editions: each entry is its own, the font's slots counted once", missed, []);

  // Left on the popover's Arcane, or under a name of its own
  const arcaneBefore = [classEntry(), fontEntry("Arcane Prepared Spells", { tradition: "Arcane" })];
  const arcane = synced(character(classRecord("Cleric"), 5, { spells: arcaneBefore }));
  assert("on Arcane: the font's", sources(arcane), ["class:cleric", "class:cleric:font"]);
  assert("its tradition is kept", entryFor(arcane, "class:cleric:font").data.tradition, "Arcane");
  assert(
    "and the notice says so",
    ctx.describeSpellcastingSync(arcaneBefore, arcane).endsWith(
      "Divine Font kept its Arcane tradition. Your class casts divine spells, so change it in its settings if that was a mistake.",
    ),
    true,
  );
  const healSpells = synced(character(classRecord("Cleric"), 5, { spells: [classEntry(), fontEntry("Heal Spells")] }));
  assert('"Heal Spells": the font\'s, and keeps its name', [sources(healSpells), names(healSpells)], [["class:cleric", "class:cleric:font"], ["Divine Prepared Spells", "Heal Spells"]]);

  // Named for the font but innate or spontaneous: the font's, keeping its type
  const innateBefore = [classEntry(), fontEntry("Divine Font", { type: "innate" })];
  const innate = synced(character(classRecord("Cleric"), 5, { spells: innateBefore }));
  assert("an innate Divine Font: the font's, none added", sources(innate), ["class:cleric", "class:cleric:font"]);
  assert("it stays innate", entryFor(innate, "class:cleric:font").data.type, "innate");
  assert(
    "the notice says its slots don't follow your level",
    ctx.describeSpellcastingSync(innateBefore, innate),
    'Divine Prepared Spells now follow your level (higher counts kept). To stop this, uncheck "Set slots from level" in its settings. Divine Font stays innate, so its slots don\'t follow your level. To have them follow, change its type to prepared in its settings.',
  );
  const spontaneous = synced(character(classRecord("Cleric"), 5, { spells: [classEntry(), fontEntry("Divine Font", { type: "spontaneous" })] }));
  assert("a spontaneous Divine Font: the font's, none added", sources(spontaneous), ["class:cleric", "class:cleric:font"]);
  assert("it stays spontaneous, with the font's slots", [entryFor(spontaneous, "class:cleric:font").data.type, counts(entryFor(spontaneous, "class:cleric:font"))], ["spontaneous", { 3: 5 }]);

  // 1st and 2nd level, the class's entry on the popover's Arcane: the font's
  // entry on Divine isn't taken as the class's
  for (const level of [1, 2]) {
    const lowLevel = synced(
      character(classRecord("Cleric"), level, {
        spells: [
          playerEntry("Arcane Prepared Spells", { attribute: "wis", numCantrips: 5, numSpells1: level + 1 }),
          playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", numSpells1: 4, spells1: preparedRows(1, 4, ["Heal", "Heal", "Heal", "Heal"]) }),
        ],
      }),
    );
    assert(`level ${level}, the class's entry on Arcane: each entry is its own`, sources(lowLevel), ["class:cleric", "class:cleric:font"]);
    assert(`level ${level}: no cantrips added to the font's`, [lowLevel.data.spells[1].data.numCantrips || 0, heals(lowLevel.data.spells[1], 1)], [0, 4]);
    assert(`level ${level}: the font's slots counted once`, total(lowLevel, 1), level + 5);
  }

  // A font's entry at an older level's rank or count, or with other spells
  // prepared, isn't taken over; the notice names it next to the new font
  const staleBefore = [classEntry(), fontEntry("Divine Prepared Spells", { numSpells3: 0, spells3: [], numSpells2: 4, spells2: preparedRows(2, 4, ["Heal"]) })];
  const stale = synced(character(classRecord("Cleric"), 5, { spells: staleBefore }));
  assert("an older font entry is left as it was", [sources(stale), counts(stale.data.spells[1])], [["class:cleric", null, "class:cleric:font"], { 2: 4 }]);
  assert(
    "and named in the notice",
    ctx.describeSpellcastingSync(staleBefore, stale).endsWith(
      "Added from your class: Divine Font. Divine Prepared Spells, left as it was, holds 4 2nd-rank slots. If these are Divine Font slots, delete it: Divine Font has its own entry now.",
    ),
    true,
  );
  const otherBefore = [classEntry(), fontEntry("Divine Prepared Spells", { spells3: preparedRows(3, 5, ["Heal", "Bless"]) })];
  const other = synced(character(classRecord("Cleric"), 5, { spells: otherBefore }));
  assert("one with other spells prepared is left as it was", sources(other), ["class:cleric", null, "class:cleric:font"]);
  assert(
    "and named in the notice",
    ctx.describeSpellcastingSync(otherBefore, other).includes("Divine Prepared Spells, left as it was, holds 5 3rd-rank slots."),
    true,
  );
  // An archetype's entry with a slot or two isn't named
  const druidBefore = [classEntry(), playerEntry("Primal Prepared Spells", { tradition: "Primal", numSpells1: 1, spells1: preparedRows(1, 1, ["Heal"]) })];
  const druid = synced(character(classRecord("Cleric"), 5, { spells: druidBefore }));
  assert("an archetype's entry isn't the font's", sources(druid), ["class:cleric", null, "class:cleric:font"]);
  assert("nor named in the notice", ctx.describeSpellcastingSync(druidBefore, druid).includes("left as it was"), false);
}

section("Review: school and studious slots kept in an entry of their own");
{
  // Level 5 wizard: the spellbook at the table without the school, and the
  // school's cantrip and slots (1 / 1 / 1 / 1) in an entry of their own.
  // Taken over, the spellbook would get them again, so nothing is taken over
  // or added until the player deletes the school's entry.
  const flags = { arcaneSchool: "school-of-battle-magic" };
  const book = playerEntry("Arcane Prepared Spells", {
    numCantrips: 5,
    numSpells1: 3,
    numSpells2: 3,
    numSpells3: 2,
    spells1: preparedRows(1, 3, ["Force Barrage"]),
  });
  const school = (name) =>
    playerEntry(name, { numCantrips: 1, numSpells1: 1, numSpells2: 1, numSpells3: 1, spells1: preparedRows(1, 1, ["Fear"]) });
  const allCounts = (record) => record.data.spells.map((entry) => [entry.data.numCantrips, counts(entry)]);
  for (const name of ["Arcane Prepared Spells", "Battle Magic Curriculum", "Wizard School Spells"]) {
    for (const [order, spells] of [
      ["listed second", [book, school(name)]],
      ["listed first", [school(name), book]],
    ]) {
      const label = `school entry "${name}" ${order}`;
      const record = synced(character(classRecord("Wizard"), 5, { flags, spells }));
      assert(`${label}: nothing taken over or added`, sources(record), [null, null]);
      assert(`${label}: counts unchanged`, allCounts(record), spells.map((entry) => [entry.data.numCantrips, counts(entry)]));
      assert(`${label}: Restore Automatic Entries shows`, record.fields.restoreSpellcastingBtn.hidden, false);
      assert(`${label}: a second sync writes nothing`, spellKeys(syncValues(record)), []);
    }
  }

  const before = [book, school("Battle Magic Curriculum")];
  const record = synced(character(classRecord("Wizard"), 5, { flags, spells: before }));
  assert(
    "the notice says why and what to do",
    ctx.describeSpellcastingSync(before, record),
    'Battle Magic Curriculum (1 cantrip and 3 slots) holds your school slots apart from the rest, so no entry was taken over or added for "Wizard Spells" (it would count them again). To have your slots follow your level, delete it, then click Restore Automatic Entries (under Add Spellcasting Entry).',
  );
  // Under the spellbook's name too, its counts tell it apart
  const sameName = [book, school("Arcane Prepared Spells")];
  assert(
    "the same name as the spellbook: the notice gives its counts",
    ctx.describeSpellcastingSync(sameName, synced(character(classRecord("Wizard"), 5, { flags, spells: sameName }))).startsWith(
      "Arcane Prepared Spells (1 cantrip and 3 slots) holds your school slots apart from the rest",
    ),
    true,
  );
  const at7 = atLevel(record, 7);
  assert("level 7, the school's entry a level behind: still nothing taken over", sources(at7), [null, null]);
  assert("nor any count changed", allCounts(at7), allCounts(record));
  const deleted = synced(apply(record, { "data.spells": [record.data.spells[0]] }));
  assert("the school's entry deleted: the spellbook is taken over", sources(deleted), ["class:wizard"]);
  assert("with the school's slots", [deleted.data.spells[0].data.numCantrips, counts(deleted.data.spells[0])], [6, { 1: 4, 2: 4, 3: 3 }]);

  // 1st level: 5 / 2 and 1 / 1
  const firstLevel = synced(
    character(classRecord("Wizard"), 1, {
      flags,
      spells: [playerEntry("Arcane Prepared Spells", { numCantrips: 5, numSpells1: 2 }), playerEntry("Arcane Prepared Spells", { numCantrips: 1, numSpells1: 1 })],
    }),
  );
  assert("1st level: nothing taken over or added", [sources(firstLevel), allCounts(firstLevel)], [[null, null], [[5, { 1: 2 }], [1, { 1: 1 }]]]);

  // Legacy magus, level 7: the studious slots in an entry of their own
  const magus = playerEntry("Arcane Prepared Spells", { numCantrips: 5, numSpells3: 2, numSpells4: 2 });
  const studious = playerEntry("Studious Spells", { numSpells2: 2, spells2: preparedRows(2, 2, ["Mirror Image", "Invisibility"]) });
  for (const [order, spells] of [
    ["listed second", [magus, studious]],
    ["listed first", [studious, magus]],
  ]) {
    const magusRecord = synced(character(classRecord("Magus", false), 7, { spells }));
    assert(`magus, studious slots ${order}: nothing taken over or added`, sources(magusRecord), [null, null]);
    assert(`magus, studious slots ${order}: counts unchanged`, allCounts(magusRecord), spells.map((entry) => [entry.data.numCantrips, counts(entry)]));
    assert(
      `magus, studious slots ${order}: the notice names them`,
      ctx.describeSpellcastingSync(spells, magusRecord).startsWith("Studious Spells (2 2nd-rank slots) holds your studious spell slots apart from the rest"),
      true,
    );
    assert(`magus, studious slots ${order}: still at 11th`, sources(atLevel(magusRecord, 11)), [null, null]);
  }

  // An entry with just a cantrip (an ancestry's, say) isn't taken for the
  // school's
  const cantripOnly = synced(
    character(classRecord("Wizard"), 5, {
      flags,
      spells: [book, playerEntry("Arcane Prepared Spells", { numCantrips: 1, cantrips: preparedRows(0, 1, ["Detect Magic"]) })],
    }),
  );
  assert("an entry with just a cantrip isn't the school's", sources(cantripOnly), ["class:wizard", null]);

  // An archetype's entry isn't taken for the school's: the spellbook is
  // taken over and given the school's slots, and the notice names the counts
  // raised next to the entry left as it was
  const archetypeBefore = [book, playerEntry("Primal Prepared Spells", { tradition: "Primal", numCantrips: 2, numSpells1: 1 })];
  const archetype = synced(character(classRecord("Wizard"), 5, { flags, spells: archetypeBefore }));
  assert("an archetype's entry: the spellbook gets the school's slots", [sources(archetype), allCounts(archetype)[0]], [["class:wizard", null], [6, { 1: 4, 2: 4, 3: 3 }]]);
  assert(
    "and the notice names the counts raised",
    ctx.describeSpellcastingSync(archetypeBefore, archetype).endsWith(
      "Arcane Prepared Spells was raised to your class's counts (cantrips 5 to 6, 1st-rank slots 3 to 4, 2nd-rank slots 3 to 4 and 3rd-rank slots 2 to 3). If another entry already holds some of these slots, lower them in Arcane Prepared Spells.",
    ),
    true,
  );
  // The school's cantrip in the spellbook and its slots apart: the slots are
  // added to the spellbook, and the notice says so
  const splitBefore = [{ ...book, data: { ...book.data, numCantrips: 6 } }, playerEntry("Curriculum Slots", { numSpells1: 1, numSpells2: 1, numSpells3: 1 })];
  const split = synced(character(classRecord("Wizard"), 5, { flags, spells: splitBefore }));
  assert(
    "school slots apart without the cantrip: the notice names the counts raised",
    ctx.describeSpellcastingSync(splitBefore, split).includes(
      "Arcane Prepared Spells was raised to your class's counts (1st-rank slots 3 to 4, 2nd-rank slots 3 to 4 and 3rd-rank slots 2 to 3).",
    ),
    true,
  );
}

section("Review: lowering the level drops slots added at ranks that are gone");
{
  let record = synced(character(classRecord("Wizard"), 5));
  record = synced(apply(record, { "data.spells.0.data.numSpells3": 3, "data.spells.0.data.numSpells1": 4 }));
  record = atLevel(record, 1);
  let entry = record.data.spells[0];
  assert("level 1: no 3rd-rank slot is kept", entry.data.numSpells3, 0);
  assert("no empty 3rd-rank rows", (entry.data.spells3 || []).length, 0);
  assert("an extra slot at a rank still there carries on", entry.data.numSpells1, 3);
  record = atLevel(record, 5);
  entry = record.data.spells[0];
  assert("back at 5th: 3rd rank from the table", entry.data.numSpells3, 2);

  // A spontaneous caster's added repertoire placeholder goes the same way
  let sorcerer = synced(
    apply(sorcererWith(bloodline("Fey", "primal"), { bloodline: "bloodline-fey" }), { "data.level": 3 }),
  );
  sorcerer = apply(sorcerer, {
    "data.spells.0.data.numSpells2": 4,
    "data.spells.0.data.spells2": [...sorcerer.data.spells[0].data.spells2, ctx.buildSpellRow("spontaneous", 2, 3)],
  });
  sorcerer = atLevel(synced(sorcerer), 1);
  assert("sorcerer: no 2nd-rank slot kept", sorcerer.data.spells[0].data.numSpells2, 0);
  assert("nor its placeholders", (sorcerer.data.spells[0].data.spells2 || []).length, 0);

  // A count typed while Set slots from level was off doesn't carry below its
  // rank either when the level went down meanwhile, and isn't added to the
  // table again on the way back up
  let typed = synced(character(classRecord("Wizard"), 5));
  typed = synced(apply(typed, { "data.spells.0.data.autoSlots": false }));
  typed = apply(typed, { "data.spells.0.data.numSpells3": 3, "data.spells.0.data.numSpells1": 4 });
  typed = atLevel(typed, 3);
  typed = synced(apply(typed, { "data.spells.0.data.autoSlots": true }));
  assert("typed while off, back on at 3rd: no 3rd-rank slots", typed.data.spells[0].data.numSpells3, 0);
  assert("typed while off: a count at a rank still there is kept", typed.data.spells[0].data.numSpells1, 4);
  typed = atLevel(typed, 5);
  assert("back at 5th: the table's 3rd-rank slots, not 2 more", typed.data.spells[0].data.numSpells3, 2);

  // The same for a sorcerer's slots and repertoire placeholders
  let typedSorcerer = synced(
    apply(sorcererWith(bloodline("Fey", "primal"), { bloodline: "bloodline-fey" }), { "data.level": 3 }),
  );
  typedSorcerer = synced(apply(typedSorcerer, { "data.spells.0.data.autoSlots": false }));
  typedSorcerer = apply(typedSorcerer, {
    "data.spells.0.data.numSpells2": 4,
    "data.spells.0.data.spells2": [...typedSorcerer.data.spells[0].data.spells2, ctx.buildSpellRow("spontaneous", 2, 3)],
  });
  typedSorcerer = synced(apply(atLevel(typedSorcerer, 1), { "data.spells.0.data.autoSlots": true }));
  assert("sorcerer typed while off: no 2nd-rank slot kept", typedSorcerer.data.spells[0].data.numSpells2, 0);
  assert("nor its placeholders", (typedSorcerer.data.spells[0].data.spells2 || []).length, 0);
  typedSorcerer = atLevel(typedSorcerer, 3);
  assert("back at 3rd: the table's 2nd-rank slots", typedSorcerer.data.spells[0].data.numSpells2, 3);
}

section("Review: turning Set slots from level back on");
{
  // A count the player lowered stays lowered
  let record = synced(character(classRecord("Wizard"), 3));
  record = synced(apply(record, { "data.spells.0.data.numSpells1": 2 }));
  record = synced(apply(record, { "data.spells.0.data.autoSlots": false }));
  assert("the table counts stay while it's off", record.data.spells[0].data.auto.base?.numSpells1, 3);
  let back = synced(apply(record, { "data.spells.0.data.autoSlots": true }));
  assert("back on: a lowered count isn't raised", back.data.spells[0].data.numSpells1, 2);
  assert("back on: a second sync writes nothing", spellKeys(syncValues(back)), []);

  // Leveled up while off: the new slots come in, the lowered count stays one under
  back = synced(apply(atLevel(record, 5), { "data.spells.0.data.autoSlots": true }));
  assert("leveled while off: still one under the table", back.data.spells[0].data.numSpells1, 2);
  assert("leveled while off: the new rank from the table", back.data.spells[0].data.numSpells3, 2);

  // Counts typed while it was off are kept as typed, even below the table
  const typed = synced(
    apply(atLevel(record, 5), {
      "data.spells.0.data.numSpells2": 1,
      "data.spells.0.data.numSpells3": 1,
      "data.spells.0.data.autoSlots": true,
    }),
  );
  assert("typed while off: kept as typed", [typed.data.spells[0].data.numSpells2, typed.data.spells[0].data.numSpells3], [1, 1]);
  assert("and still one under the table at 1st rank", typed.data.spells[0].data.numSpells1, 2);
  const later = atLevel(typed, 7);
  assert("the typed ones carry on from there", [later.data.spells[0].data.numSpells2, later.data.spells[0].data.numSpells3], [1, 2]);

  // A Divine Font count typed while off stays as typed when the font's rank
  // moves meanwhile, and isn't counted again
  const fontOff = (count, toLevel) => {
    let cleric = synced(character(classRecord("Cleric"), 5));
    const index = sources(cleric).indexOf("class:cleric:font");
    cleric = synced(apply(cleric, { [`data.spells.${index}.data.autoSlots`]: false }));
    cleric = apply(cleric, { [`data.spells.${index}.data.numSpells3`]: count });
    for (let level = 6; level <= toLevel; level++) cleric = atLevel(cleric, level);
    return synced(apply(cleric, { [`data.spells.${index}.data.autoSlots`]: true }));
  };
  const raised = fontOff(6, 7);
  assert("font raised while off: 6 at its new rank", counts(entryFor(raised, "class:cleric:font")), { 4: 6 });
  assert("and 6 rows there", entryFor(raised, "class:cleric:font").data.spells4.length, 6);
  assert("then a sync writes nothing", spellKeys(syncValues(raised)), []);
  assert("font lowered while off: stays lowered at its new rank", counts(entryFor(fontOff(4, 7), "class:cleric:font")), { 4: 4 });
  assert("font typed while off, on two ranks later", counts(entryFor(fontOff(7, 9), "class:cleric:font")), { 5: 7 });
  assert("font typed while off, same rank: kept as typed", counts(entryFor(fontOff(6, 6), "class:cleric:font")), { 3: 6 });
  // Its rank moving down while off: the same
  let down = synced(character(classRecord("Cleric"), 7));
  const downIndex = sources(down).indexOf("class:cleric:font");
  down = synced(apply(down, { [`data.spells.${downIndex}.data.autoSlots`]: false }));
  down = atLevel(apply(down, { [`data.spells.${downIndex}.data.numSpells4`]: 6 }), 5);
  down = synced(apply(down, { [`data.spells.${downIndex}.data.autoSlots`]: true }));
  assert("font typed while off, rank moved down: kept as typed", counts(entryFor(down, "class:cleric:font")), { 3: 6 });
  // An extra slot added before it was turned off carries on as before
  let before = synced(character(classRecord("Cleric"), 5));
  const beforeIndex = sources(before).indexOf("class:cleric:font");
  before = synced(apply(before, { [`data.spells.${beforeIndex}.data.numSpells3`]: 6 }));
  before = synced(apply(before, { [`data.spells.${beforeIndex}.data.autoSlots`]: false }));
  before = synced(apply(atLevel(atLevel(before, 6), 7), { [`data.spells.${beforeIndex}.data.autoSlots`]: true }));
  assert("font extra from before it was off: carried to its new rank", counts(entryFor(before, "class:cleric:font")), { 4: 6 });
  assert("and a sync writes nothing", spellKeys(syncValues(before)), []);
}

section("Review: only the owner or the GM runs the takeover");
{
  const sheet = { _id: "pc", recordType: "characters", ownerId: "player-1", data: {} };
  const viewAs = (gm, user) => {
    ctx.isGM = gm;
    ctx.userId = user;
    return ctx.canEditRecord(sheet);
  };
  assert("the GM", viewAs(true, "gm"), true);
  assert("the owner", viewAs(false, "player-1"), true);
  assert("another player", viewAs(false, "player-2"), false);
  assert("no user known: as before", viewAs(false, undefined), true);
  ctx.isGM = true;
  delete ctx.userId;
}

section("Review: the takeover notice matches entries by source");
{
  // A wizard entry left empty when the class changed to cleric is removed
  // ahead of the player's entry
  const leftover = { ...synced(character(classRecord("Wizard"), 3)).data.spells[0] };
  const player = playerEntry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", numCantrips: 5, numSpells1: 3, numSpells2: 2 });
  const before = [leftover, player];
  const record = synced(character(classRecord("Cleric"), 3, { spells: before }));
  assert("the empty wizard entry is gone", names(record), ["Divine Prepared Spells", "Divine Font"]);
  assert(
    "the notice names the entry taken over and the one added",
    ctx.describeSpellcastingSync(before, record),
    'Divine Prepared Spells now follow your level (higher counts kept). To stop this, uncheck "Set slots from level" in its settings. Added from your class: Divine Font.',
  );
}

section("Review: Flexible Spellcaster, dragon eidolon and Universalist");
{
  const flexibleFeature = {
    _id: "flex",
    name: "Flexible Spell Preparation",
    recordType: "features",
    data: { type: "classfeature", level: 1, traits: ["Common", "Class-Archetype"] },
  };
  const flexible = (name, level, data = {}) =>
    character(classRecord(name, false, { features: [flexibleFeature] }), level, data);
  const spec = (record, level) => ctx.getWantedSpellcastingEntries(record, level)[0];
  assert("flexible wizard, 2nd level: 2 1st-rank slots", spec(flexible("Wizard", 2), 2).counts.numSpells1, 2);
  assert("flexible wizard, 1st level: 3 cantrips", spec(flexible("Wizard", 1), 1).counts.numCantrips, 3);
  assert("flexible wizard, 2nd level: 4 cantrips", spec(flexible("Wizard", 2), 2).counts.numCantrips, 4);
  assert("flexible wizard, 19th level: 2 of each rank and one 10th", counts({ data: spec(flexible("Wizard", 19), 19).counts }), { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 1 });
  assert(
    "the school slot is unchanged",
    spec(flexible("Wizard", 4, { flags: { arcaneSchool: "evocation" } }), 4).counts.numSpells2,
    3,
  );
  const dedication = character(classRecord("Druid"), 3, {
    feats: [{ _id: "ded", name: "Flexible Spellcaster Dedication", recordType: "feats", data: { level: 2, type: "class" } }],
  });
  assert("from the dedication too", counts({ data: spec(dedication, 3).counts }), { 1: 2, 2: 2 });
  const flexibleCleric = ctx.getWantedSpellcastingEntries(flexible("Cleric", 5), 5);
  assert("flexible cleric: 2 of each rank", counts({ data: flexibleCleric[0].counts }), { 1: 2, 2: 2, 3: 2 });
  assert("and the same Divine Font", counts({ data: flexibleCleric[1].counts }), { 3: 5 });
  assert(
    "a sorcerer isn't changed",
    spec(character(classRecord("Sorcerer", false, { features: [flexibleFeature] }), 2), 2).counts.numSpells1,
    4,
  );

  const summoner = (remaster) =>
    character(classRecord("Summoner", remaster), 1, { flags: { eidolon: "dragon-eidolon" } });
  assert("legacy dragon eidolon, feature missing: arcane", spec(summoner(false), 1).tradition, "Arcane");
  assert("remaster dragon eidolon: no fixed tradition", spec(summoner(true), 1).tradition, null);

  const wizard = (school) => character(classRecord("Wizard", false), 1, { flags: { arcaneSchool: school } });
  assert("Universalist Wizard: no school slot", spec(wizard("universalist-wizard"), 1).counts.numSpells1, 2);
  assert("Arcane School: Universalist: no school slot", spec(wizard("arcane-school-universalist"), 1).counts.numSpells1, 2);
  assert("Unified Magical Theory by another name: no school slot", spec(wizard("unified-magical-theory"), 1).counts.numSpells1, 2);
}

section("Re-review: another class's word, font names, cantrips, wrong type, saved notice");
{
  const filledNames = (entry, rank) =>
    (entry.data[rank === 0 ? "cantrips" : `spells${rank}`] || [])
      .filter((row) => row?.data?.type !== "slot")
      .map((row) => row.name);
  const divine = (name, data) => playerEntry(name, { tradition: "Divine", attribute: "wis", ...data });
  const cleric = (level, spells) =>
    character(classRecord("Cleric"), level, { flags: { divineFont: "healing" }, spells });
  const clericSpells = () =>
    divine("Cleric Spells", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 2 });

  // Another class's word in the name of an entry holding the class's slots
  for (const name of [
    "The Witch's Grimoire",
    "Magus Tome of Ezren",
    "Ezren's Druid-Bane Spellbook",
    "Oracle Bones",
    "Necromancer's Bane Book",
  ]) {
    const book = playerEntry(name, {
      numCantrips: 5,
      cantrips: ["Shield", "Light", "Detect Magic", "Prestidigitation", "Electric Arc"].map((spell) => filled(spell, { level: 0 })),
      numSpells1: 3,
      spells1: preparedRows(1, 3, ["Sleep", "Fear", "Grease"]),
      numSpells2: 3,
      spells2: preparedRows(2, 3, ["Blur", "Mist", "Web"]),
      numSpells3: 2,
      spells3: preparedRows(3, 2, ["Fireball", "Haste"]),
    });
    const record = synced(character(classRecord("Wizard"), 5, { spells: [book] }));
    assert(`"${name}" with the class's slots is taken over, and no entry is added`, sources(record), ["class:wizard"]);
  }

  // Setup A: a dedication named for Font of Arcana isn't the Divine Font
  const fontOfArcana = playerEntry("Sorcerer Dedication (Font of Arcana)", {
    type: "spontaneous",
    attribute: "cha",
    numSpells1: 1,
    spells1: [filled("Grease", { level: 1 })],
    numSpells2: 1,
    spells2: [filled("Blur", { level: 2 })],
    numSpells3: 1,
    spells3: [filled("Haste", { level: 3 })],
  });
  const setupA = synced(
    cleric(8, [
      divine("Cleric Spells", { numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3, numSpells4: 3 }),
      fontOfArcana,
    ]),
  );
  const dedication = setupA.data.spells.find((entry) => entry.name === fontOfArcana.name);
  assert("Setup A: the dedication's entry is left as it was", [dedication.data.auto, counts(dedication)], [undefined, { 1: 1, 2: 1, 3: 1 }]);
  assert("Setup A: its spells stay at their ranks", [1, 2, 3].map((rank) => filledNames(dedication, rank)), [["Grease"], ["Blur"], ["Haste"]]);
  assert("Setup A: a Divine Font entry is added", [entryFor(setupA, "class:cleric:font").name, counts(entryFor(setupA, "class:cleric:font"))], ["Divine Font", { 4: 5 }]);

  // Setup B: cantrips in their own entry, the font folded into the class's
  const setupBEntries = [
    divine("Cantrips", {
      numCantrips: 5,
      cantrips: ["Light", "Stabilize", "Shield", "Guidance", "Divine Lance"].map((spell) => filled(spell, { level: 0 })),
    }),
    divine("Cleric Spells + Font", {
      numSpells1: 3,
      spells1: preparedRows(1, 3, ["Bless", "Command", "Fear"]),
      numSpells2: 3,
      spells2: preparedRows(2, 3, ["Silence", "Calm", "Sound Burst"]),
      numSpells3: 7,
      spells3: preparedRows(3, 7, ["Blindness", "Heroism", "Heal", "Heal", "Heal", "Heal", "Heal"]),
    }),
  ];
  const setupB = synced(cleric(5, setupBEntries));
  const folded = setupB.data.spells.find((entry) => entry.name === "Cleric Spells + Font");
  assert("Setup B: the entry with the font folded in is the class's", [folded.data.auto?.source, counts(folded)], ["class:cleric", { 1: 3, 2: 3, 3: 2 }]);
  assert(
    "Setup B: its other spells stay at their ranks",
    [1, 2, 3].map((rank) => filledNames(folded, rank)),
    [["Bless", "Command", "Fear"], ["Silence", "Calm", "Sound Burst"], ["Blindness", "Heroism"]],
  );
  assert("Setup B: the heals move to the Divine Font", filledNames(entryFor(setupB, "class:cleric:font"), 3), ["Heal", "Heal", "Heal", "Heal", "Heal"]);
  assert("Setup B: no other class entry is added", names(setupB), ["Cantrips", "Cleric Spells + Font", "Divine Font"]);
  assertIncludes("Setup B: the notice names the cantrips it raised", ctx.describeSpellcastingSync(setupBEntries, setupB), "(cantrips 0 to 5)");

  // Setup C: "font" inside another word
  const scrolls = divine("Fontaine's Scrolls", {
    numSpells1: 2,
    spells1: preparedRows(1, 2, ["Bless", "Command"]),
    numSpells2: 1,
    spells2: preparedRows(2, 1, ["Silence"]),
  });
  const setupC = synced(cleric(5, [clericSpells(), scrolls]));
  const scrollsAfter = setupC.data.spells.find((entry) => entry.name === scrolls.name);
  assert(
    "Setup C: Fontaine's Scrolls is left as it was",
    [scrollsAfter.data.auto, counts(scrollsAfter), filledNames(scrollsAfter, 1), filledNames(scrollsAfter, 2)],
    [undefined, { 1: 2, 2: 1 }, ["Bless", "Command"], ["Silence"]],
  );
  assert("Setup C: a Divine Font entry is added", [entryFor(setupC, "class:cleric:font").name, counts(entryFor(setupC, "class:cleric:font"))], ["Divine Font", { 3: 5 }]);

  // Named for the font but holding other spells: left as it was and named
  const extras = divine("Healing Font Extras", {
    numSpells3: 5,
    spells3: preparedRows(3, 5, ["Heal", "Heal", "Heal", "Heal", "Bless"]),
  });
  const extrasEntries = [clericSpells(), extras];
  const withExtras = synced(cleric(5, extrasEntries));
  const extrasAfter = withExtras.data.spells.find((entry) => entry.name === extras.name);
  assert(
    "a font-named entry with other spells is left as it was",
    [extrasAfter.data.auto, counts(extrasAfter), filledNames(extrasAfter, 3)],
    [undefined, { 3: 5 }, ["Heal", "Heal", "Heal", "Heal", "Bless"]],
  );
  assertIncludes(
    "and the notice names it",
    ctx.describeSpellcastingSync(extrasEntries, withExtras),
    "Healing Font Extras was left as it was, as it holds spells other than heal or harm.",
  );

  // Only heal and harm move up with the font's rank
  let level6 = synced(cleric(6, []));
  const fontIndex = level6.data.spells.findIndex((entry) => entry.data.auto?.source === "class:cleric:font");
  level6 = apply(level6, {
    [`data.spells.${fontIndex}.data.spells3`]: [
      filled("Heal", { level: 3 }),
      filled("Heal", { level: 3 }),
      filled("Bless", { level: 3 }),
      ...level6.data.spells[fontIndex].data.spells3.slice(3),
    ],
  });
  const level7 = entryFor(atLevel(level6, 7), "class:cleric:font");
  assert("level 7: the heals move up with the font", filledNames(level7, 4), ["Heal", "Heal"]);
  assert("level 7: Bless stays at its rank", filledNames(level7, 3), ["Bless"]);

  // A main entry with no cantrips, from 2nd level
  const spellbook = playerEntry("Spellbook", { numSpells1: 3, spells1: preparedRows(1, 3, ["Sleep", "Fear", "Grease"]) });
  const noCantrips = character(classRecord("Wizard"), 2, { spells: [spellbook] });
  assert("level 2: a main entry with no cantrips is taken over", sources(synced(noCantrips)), ["class:wizard"]);
  const healSide = divine("Cleric Heal Slots", { numSpells3: 4, spells3: preparedRows(3, 4, ["Heal", "Heal", "Heal", "Heal"]) });
  assert(
    "a lone heal entry is still taken over by the class",
    entryFor(synced(cleric(5, [healSide])), "class:cleric")?.name,
    "Cleric Heal Slots",
  );

  // The class's entry set to the other way of casting
  const mistypedEntry = playerEntry("Sorcerer Spells", {
    type: "prepared",
    tradition: "Occult",
    attribute: "cha",
    numCantrips: 5,
    numSpells1: 4,
    numSpells2: 3,
  });
  const mistypedStart = apply(sorcererWith(bloodline("Aberrant", "occult"), { bloodline: "bloodline-aberrant" }), {
    "data.level": 3,
    "data.spells": [mistypedEntry],
  });
  const mistyped = synced(mistypedStart);
  assert("wrong type: no class entry is added", sources(mistyped), [null]);
  assert("wrong type: Restore Automatic Entries shows", mistyped.fields.restoreSpellcastingBtn.hidden, false);
  assert(
    "wrong type: the notice says to set its type",
    ctx.describeSpellcastingSync([mistypedEntry], mistyped),
    'Sorcerer Spells looks like your Sorcerer entry but is set to prepared, so "Sorcerer Spells" wasn\'t added (it would double your slots). Set Sorcerer Spells to spontaneous in its settings, then click Restore Automatic Entries (under Add Spellcasting Entry).',
  );
  assert(
    "set to spontaneous, it is taken over",
    sources(synced(apply(mistyped, { "data.spells.0.data.type": "spontaneous" }))),
    ["class:sorcerer"],
  );

  // The first takeover's notice is kept for the owner
  const firstValues = syncValues(noCantrips);
  const firstSynced = apply(noCantrips, firstValues);
  assert(
    "an existing character's first takeover keeps its notice",
    firstValues["data.spellcastingNotice"],
    ctx.describeSpellcastingSync(noCantrips.data.spells, firstSynced),
  );
  assert("a second sync keeps no other", "data.spellcastingNotice" in syncValues(firstSynced), false);
  assert("a new character keeps none", "data.spellcastingNotice" in syncValues(character(classRecord("Wizard"), 2)), false);

  const shown = [];
  let written = null;
  const { showNotification, setValues } = ctx.api;
  ctx.api.showNotification = (message) => shown.push(message);
  ctx.api.setValues = (values) => {
    written = values;
  };
  const kept = { ...firstSynced, ownerId: "player" };
  ctx.isGM = true;
  ctx.userId = "gm";
  ctx.showSpellcastingNotice(kept);
  assert("a GM opening the sheet doesn't see the player's notice", [shown.length, written], [0, null]);
  ctx.showSpellcastingNotice(kept, true);
  assert("a GM whose open ran the takeover sees it, and it's kept for the player", [shown.length, written], [1, null]);
  ctx.isGM = false;
  ctx.userId = "player";
  ctx.showSpellcastingNotice(kept);
  assert(
    "the owner's open shows it and clears it",
    [shown, written],
    [[kept.data.spellcastingNotice, kept.data.spellcastingNotice], { "data.spellcastingNotice": null }],
  );
  ctx.api.showNotification = showNotification;
  ctx.api.setValues = setValues;
  ctx.isGM = true;
  delete ctx.userId;
}

process.exitCode = summary();
