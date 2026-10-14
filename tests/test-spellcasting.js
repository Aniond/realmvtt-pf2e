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
    ctx.describeSpellcastingSync(before.data.spells, record.data.spells),
    'Arcane Prepared Spells now follow your level (higher counts kept). To stop this, uncheck "Set slots from level" in its settings.',
  );
  record = atLevel(record, 2);
  assert("the extra slots carry on", record.data.spells[0].data.numSpells1, 6);

  const low = synced(character(classRecord("Wizard"), 1, { spells: [manual({ numSpells1: 1 })] }));
  assert("adoption never lowers, only raises", low.data.spells[0].data.numSpells1, 2);

  const other = synced(character(classRecord("Wizard"), 1, { spells: [manual({ tradition: "Divine" }, "Divine Innate")] }));
  assert("another tradition is not adopted", other.data.spells.map((e) => e.name), ["Divine Innate", "Wizard Spells"]);
  assert("and is left unmanaged", other.data.spells[0].data.auto, undefined);
  assert(
    "notice for an added entry",
    ctx.describeSpellcastingSync(
      [manual({ tradition: "Divine" }, "Divine Innate")],
      other.data.spells,
    ),
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
  record = apply(record, { "data.spells.0.data.training": 3 });
  record = synced(record);
  assert("a managed entry follows the character's rank", record.data.spells[0].data.training, 2);
  assert("DC from that rank", record.data.spells[0].data.dc, 10 + 4 + 4 + 7);

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

process.exitCode = summary();
