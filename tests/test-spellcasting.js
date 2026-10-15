// Tests for the spellcasting entries made from the class: slot tables, the
// sync run by onAddEditFeature, opting in entries the player made, and the
// Level Up summary lines.

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
      // Their class was added since its entries are made automatically
      autoSpellcasting: true,
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

// Checks "Set slots from level" on an entry the player made, as the sheet
// does. Returns the record after the opt-in and the sync it runs, the
// notices shown and the prompt, which `pick` answers with a source.
function optIn(record, index, pick = null) {
  const shown = { notices: [], prompt: null };
  let current = JSON.parse(JSON.stringify(record));
  const { setValues, showNotification, showPrompt } = ctx.api;
  const onAddEditFeature = ctx.onAddEditFeature;
  ctx.api.setValues = (values, callback) => {
    current = apply(current, values);
    if (typeof callback === "function") callback(current);
  };
  ctx.api.showNotification = (message) => shown.notices.push(message);
  ctx.api.showPrompt = (title, description, placeholder, options, query, callback) => {
    shown.prompt = { title, description, options };
    callback(pick);
  };
  ctx.onAddEditFeature = (updated, callback) => {
    current = synced(updated);
    if (typeof callback === "function") callback();
  };
  try {
    ctx.optInSpellcastingEntry(current, `data.spells.${index}`);
  } finally {
    Object.assign(ctx.api, { setValues, showNotification, showPrompt });
    ctx.onAddEditFeature = onAddEditFeature;
  }
  return { record: current, ...shown };
}

// A character whose class was added before its entries were made
// automatically
const existingCharacter = (classObj, level, spells, data = {}) =>
  character(classObj, level, { autoSpellcasting: undefined, spells, ...data });

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
        // An oracle also knows its mystery's cantrip, and a psychic their psi
        // cantrips
        const cantrips =
          (Array.isArray(rules.cantrips) ? rules.cantrips[level - 1] : rules.cantrips) +
          (slug === "oracle" ? 1 : 0) +
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

  // Review: a rank set by hand isn't lost on opting in (level 7 wizard set to
  // Master while the character's rank is Expert)
  const handSet = {
    name: "Arcane Prepared Spells",
    data: { type: "prepared", tradition: "Arcane", attribute: "int", training: "3", numCantrips: 5, numSpells1: 3, numSpells2: 3, numSpells3: 3, numSpells4: 2 },
    fields: {},
  };
  const master = optIn(existingCharacter(classRecord("Wizard"), 7, [handSet], { spellcasting: "2" }), 0).record;
  assert("opted in", master.data.spells[0].data.auto.source, "class:wizard");
  assert("a hand-set Master entry stays Master", master.data.spells[0].data.training, 3);
  assert("its DC uses Master", master.data.spells[0].data.dc, 10 + 4 + 6 + 7);
  assert("kept as the entry's own rank", master.data.spells[0].data.auto.ownTraining, 3);
  assert("then a sync writes nothing", spellKeys(syncValues(master)), []);
  const followed = optIn(
    existingCharacter(classRecord("Wizard"), 7, [{ ...handSet, data: { ...handSet.data, training: 2 } }], { spellcasting: "2" }),
    0,
  ).record;
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

section("Review: only the owner or the GM recalculates the sheet on open");
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

section("A class's empty entries go when the class changes");
{
  const leftover = { ...synced(character(classRecord("Wizard"), 3)).data.spells[0] };
  const record = synced(character(classRecord("Cleric"), 3, { spells: [leftover] }));
  assert("the empty wizard entry is gone", names(record), ["Cleric Spells", "Divine Font"]);
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


section("The Divine Font's rank rising moves only heal and harm");
{
  const filledNames = (entry, rank) =>
    (entry.data[rank === 0 ? "cantrips" : `spells${rank}`] || [])
      .filter((row) => row?.data?.type !== "slot")
      .map((row) => row.name);
  const cleric = (level, spells) =>
    character(classRecord("Cleric"), level, { flags: { divineFont: "healing" }, spells });
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
}

section("Characters whose class was added before entries were made automatically");
{
  const own = playerEntry("Spellbook", { numCantrips: 5, numSpells1: 3, numSpells2: 3, spells1: preparedRows(1, 3, ["Sleep"]) });
  const before = existingCharacter(classRecord("Wizard"), 5, [own]);
  const after = synced(before);
  assert("their entry isn't taken over", [names(after), sources(after)], [["Spellbook"], [null]]);
  assert("its counts stay as they were", [after.data.spells[0].data.numCantrips, counts(after.data.spells[0])], [5, { 1: 3, 2: 3 }]);
  assert("no entry is added", after.data.spells.length, 1);
  assert("nor on a level up", names(atLevel(after, 6)), ["Spellbook"]);
  assert("no Restore Automatic Entries", after.fields.restoreSpellcastingBtn.hidden, true);
  const none = synced(existingCharacter(classRecord("Cleric"), 3, [], { flags: { divineFont: "healing" } }));
  assert("a caster with no entries gets none", (none.data.spells || []).length, 0);

  // Entries the sheet already manages keep following the level
  const managed = apply(synced(character(classRecord("Wizard"), 3)), { "data.autoSpellcasting": false });
  assert("a managed entry still follows the level", counts(entryFor(atLevel(managed, 5), "class:wizard")), { 1: 3, 2: 3, 3: 2 });
  const lost = synced(apply(managed, { "data.spells": [] }));
  assert("but isn't made again once deleted", (lost.data.spells || []).length, 0);

  // Restore Automatic Entries on a character from before makes them
  const restored = synced(
    apply(existingCharacter(classRecord("Wizard"), 3, [], { spellcastingDismissed: ["class:wizard"] }), {
      "data.spellcastingDismissed": [],
      "data.autoSpellcasting": true,
    }),
  );
  assert("Restore makes the class's entries", names(restored), ["Wizard Spells"]);
  assert(
    "and its notice names them",
    ctx.describeAddedSpellcastingEntries([], restored),
    "Added from your class: Wizard Spells.",
  );
}

section("A class added makes its entries");
{
  // onDropClass sets autoSpellcasting; the creation wizard drops the class too
  const cleric = synced(character(classRecord("Cleric"), 1, { flags: { divineFont: "healing" } }));
  assert("the class's entries are made", names(cleric), ["Cleric Spells", "Divine Font"]);
  assert("next to an entry the player made, which is left alone", names(synced(character(classRecord("Wizard"), 1, { spells: [playerEntry("Scrolls", { numSpells1: 1 })] }))), ["Scrolls", "Wizard Spells"]);
  for (const name of ["Animist", "Cleric", "Sorcerer", "Wizard", "Psychic"]) {
    const record = synced(character(classRecord(name), 16, { flags: { divineFont: "healing" } }));
    assert(`a new level 16 ${name.toLowerCase()}: a second sync writes nothing`, spellKeys(syncValues(record)), []);
  }
}

section("Set slots from level on an entry the player made");
{
  // One entry to follow: no prompt
  const book = playerEntry("Spellbook", { numSpells1: 2, spells1: preparedRows(1, 2, ["Sleep"]) });
  let result = optIn(existingCharacter(classRecord("Wizard"), 3, [book]), 0);
  let entry = result.record.data.spells[0];
  assert("it follows the class's entry", entry.data.auto.source, "class:wizard");
  assert("no prompt for a class with one", result.prompt, null);
  assert("its counts are raised to the class's", [entry.data.numCantrips, counts(entry)], [5, { 1: 3, 2: 2 }]);
  assert("its spells stay", entry.data.spells1[0].name, "Sleep");
  assert("nothing is added beside it", names(result.record), ["Spellbook"]);
  assert("the notice says so", result.notices, [
    'Spellbook now follows your level as your class\'s Wizard Spells (higher counts kept). To stop this, uncheck "Set slots from level" in its settings. Its counts were raised to your class\'s (cantrips 0 to 5, 1st-rank slots 2 to 3, 2nd-rank slots 0 to 2).',
  ]);
  assert("a sync after writes nothing", spellKeys(syncValues(result.record)), []);
  assert("it follows the level from then on", counts(entryFor(atLevel(result.record, 5), "class:wizard")), { 1: 3, 2: 3, 3: 2 });
  const over = optIn(existingCharacter(classRecord("Wizard"), 3, [playerEntry("Spellbook", { numCantrips: 5, numSpells1: 4, numSpells2: 2 })]), 0).record;
  assert("a count over the class's is kept", counts(over.data.spells[0]), { 1: 4, 2: 2 });
  assert("and stays over it at the next level", counts(atLevel(over, 4).data.spells[0]), { 1: 4, 2: 3 });

  // Several to follow: the player picks one
  const divine = (name) => playerEntry(name, { tradition: "Divine", attribute: "wis", numCantrips: 5, numSpells1: 2 });
  const cleric = (spells) => existingCharacter(classRecord("Cleric"), 1, spells, { flags: { divineFont: "healing" } });
  result = optIn(cleric([divine("Divine Prepared Spells")]), 0, "class:cleric");
  assert("the prompt lists the class's entries", result.prompt.options, [
    { label: "Cleric Spells", value: "class:cleric" },
    { label: "Divine Font", value: "class:cleric:font" },
  ]);
  assert("the one picked is followed", result.record.data.spells[0].data.auto.source, "class:cleric");
  const second = optIn(
    apply(result.record, { "data.spells": [...result.record.data.spells, divine("Healing Font")] }),
    1,
  );
  assert("the next entry is offered only what's left, without a prompt", [second.prompt, second.record.data.spells[1].data.auto.source], [null, "class:cleric:font"]);
  const font = optIn(cleric([divine("Heal Slots")]), 0, "class:cleric:font").record.data.spells[0];
  assert("picking the Divine Font", [font.data.auto.source, counts(font), font.data.numCantrips], ["class:cleric:font", { 1: 4 }, 5]);
  const cancelled = optIn(cleric([divine("Divine Prepared Spells")]), 0, null).record.data.spells[0];
  assert("cancelling the prompt unchecks it", [cancelled.data.autoSlots, cancelled.data.auto], [false, undefined]);

  // Nothing to follow
  result = optIn(synced(character(classRecord("Wizard"), 3, { spells: [book] })), 0);
  assert("with every class entry followed, it's unchecked", [result.record.data.spells[0].data.autoSlots, result.record.data.spells[0].data.auto], [false, undefined]);
  assert("and the notice says why", result.notices, ["Each of your class's spellcasting entries already has an entry that follows your level."]);
  result = optIn(existingCharacter(classRecord("Wizard"), 3, [playerEntry("Innate Spells", { type: "innate" })]), 0);
  assert("an innate entry can't follow", [result.record.data.spells[0].data.autoSlots, result.notices], [false, ["Only prepared and spontaneous entries can follow your level."]]);
  result = optIn(existingCharacter(classRecord("Fighter"), 3, [book]), 0);
  assert("nor one on a class without spell slots", result.notices, ["Your class has no spell slots for this entry to follow."]);

  // The class's deleted entry
  result = optIn(synced(character(classRecord("Wizard"), 3, { spellcastingDismissed: ["class:wizard"], spells: [book] })), 0);
  assert("opting in clears the class's deleted entry", [result.record.data.spells[0].data.auto.source, result.record.data.spellcastingDismissed], ["class:wizard", []]);
  assert("so Restore Automatic Entries hides", result.record.fields.restoreSpellcastingBtn.hidden, true);

  // A tradition other than the class's is kept and named
  result = optIn(cleric([playerEntry("Arcane Prepared Spells", { numCantrips: 5, numSpells1: 2 })]), 0, "class:cleric");
  assert("the player's tradition is kept", result.record.data.spells[0].data.tradition, "Arcane");
  assertIncludes("and named in the notice", result.notices[0], "It kept its Arcane tradition. Your class casts divine spells, so change it in its settings if that was a mistake.");

  // A spontaneous entry
  const repertoire = playerEntry("Occult Spontaneous Spells", { type: "spontaneous", tradition: "Occult", attribute: "cha", numSpells1: 3, spells1: ["Fear", "Sleep"].map((name) => filled(name, { level: 1 })) });
  const sorcerer = apply(sorcererWith(bloodline("Aberrant", "occult"), { bloodline: "bloodline-aberrant" }), {
    "data.level": 3,
    "data.autoSpellcasting": false,
    "data.spells": [repertoire],
  });
  const spontaneous = optIn(sorcerer, 0).record.data.spells[0];
  assert("a spontaneous entry follows the class", [spontaneous.data.auto.source, counts(spontaneous)], ["class:sorcerer", { 1: 4, 2: 3 }]);
  assert("its repertoire keeps its spells", spontaneous.data.spells1.filter((row) => row?.data?.type !== "slot").map((row) => row.name), ["Fear", "Sleep"]);
}

section("A remastered oracle's mystery adds its spells to the repertoire");
{
  const oracle = (level, mystery, remaster = true) =>
    ctx.getWantedSpellcastingEntries(
      character(classRecord("Oracle", remaster), level, mystery ? { flags: { mystery } } : {}),
      level,
    )[0];
  // Repertoire spells over the slots, by rank
  const extras = (spec) => {
    const out = {};
    for (let rank = 1; rank <= 9; rank++) {
      const extra = (spec.repertoire[`rep${rank}`] || 0) - (spec.counts[`numSpells${rank}`] || 0);
      if (extra) out[rank] = extra;
    }
    return out;
  };
  assert("no mystery yet: its cantrip and 1st-rank spell", [oracle(1).repertoire.repCantrips, extras(oracle(1))], [6, { 1: 1 }]);
  assert("Flames at 3rd: its 2nd-rank spell", extras(oracle(3, "flames")), { 1: 1, 2: 1 });
  assert("Flames at 5th: and its 3rd-rank spell", extras(oracle(5, "flames")), { 1: 1, 2: 1, 3: 1 });
  assert("Tempest at 11th: 4th and 6th rank", extras(oracle(11, "tempest")), { 1: 1, 4: 1, 6: 1 });
  assert("Lore at 5th: 3rd rank", extras(oracle(5, "lore")), { 1: 1, 3: 1 });
  assert("a flag named like mystery-time", extras(oracle(13, "mystery-time")), { 1: 1, 3: 1, 7: 1 });
  assert("the legacy oracle: only its cantrip", [oracle(5, "flames", false).repertoire.repCantrips, extras(oracle(5, "flames", false))], [6, {}]);
}

process.exitCode = summary();
