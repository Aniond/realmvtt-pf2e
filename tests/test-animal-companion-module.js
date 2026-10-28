// Tests for the Animal Companions module's records (modules/animal-companions,
// roadmap H14 phase 2): companion characters built from the generated
// ancestries, class and feats, worked out by the ruleset's own
// recalculation and Strike, against stat blocks worked by hand from Player
// Core pg. 206-211.
// Run: node tests/test-animal-companion-module.js (or via tests/run-all.js)

const path = require("path");
const fs = require("fs");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const moduleDir = path.join(__dirname, "..", "modules", "animal-companions");
const RECORDS = JSON.parse(fs.readFileSync(path.join(moduleDir, "records.json"), "utf8"));
const { build } = require(path.join(moduleDir, "build.js"));

const copy = (value) => JSON.parse(JSON.stringify(value));
const setPath = (target, dotted, value) => {
  const keys = dotted.split(".");
  let at = target;
  for (const key of keys.slice(0, -1)) at = at[key] = at[key] ?? {};
  at[keys[keys.length - 1]] = value;
};
const featNamed = (name) => copy(RECORDS.feats.find((f) => f.name === name));

// A companion character from the module's records: its type's ancestry, the
// Animal Companion class and stage feats, worked out as the sheet does
// (onAddEditFeature, run until it settles)
function companion(type, level, feats = [], { size } = {}) {
  const ancestry = copy(RECORDS.ancestry.find((a) => a.name === type));
  const record = {
    _id: `c-${type}-${level}`,
    recordType: "characters",
    name: type,
    effects: [],
    effectIds: [],
    fields: {},
    data: {
      level,
      classes: [copy(RECORDS.class[0])],
      ancestries: [ancestry],
      heritages: [],
      feats: feats.map(featNamed),
      bonusFeats: [],
      features: [],
      inventory: [],
      actions: [],
      size: size || ancestry.data.size,
      speed: ancestry.data.speed,
    },
  };
  const write = (values, cb) => {
    Object.entries(values).forEach(([key, value]) => setPath(record, key, value));
    if (cb) cb(record);
  };
  ctx.api.setValuesOnRecord = (r, values, cb) => write(values, cb);
  ctx.api.setValues = (values, cb) => write(values, cb);
  for (let i = 0; i < 3; i++) ctx.onAddEditFeature(record, undefined, true);
  return record;
}

// A Strike with the named natural attack: its bonus and damage
function strike(record, weaponName) {
  const index = record.data.inventory.findIndex((item) => item.name === weaponName);
  let captured = { mods: [], meta: {} };
  const saved = ctx.api.promptRoll;
  ctx.api.promptRoll = (name, dice, mods, meta) => (captured = { mods: mods || [], meta: meta || {} });
  try {
    ctx.performAttackRoll(record, record.data.inventory[index], `data.inventory.${index}`, 1);
  } finally {
    ctx.api.promptRoll = saved;
  }
  const active = (list) => list.filter((m) => m.active !== false);
  const damageBonus = active(captured.meta.damageModifiers || []).reduce((sum, m) => sum + (parseInt(m.value, 10) || 0), 0);
  return {
    bonus: active(captured.mods).reduce((sum, m) => sum + (parseInt(m.value, 10) || 0), 0),
    damage: `${captured.meta.damage}`.replace(/ (\w+)$/, `+${damageBonus} $1`),
    traits: captured.meta.traits || [],
  };
}

section("The module's records");
{
  assert("16 ancestries, one class, 10 feats", [RECORDS.ancestry.length, RECORDS.class.length, RECORDS.feats.length], [16, 1, 10]);
  assert("records.json is what build.js makes (rebuild after changing it)", JSON.stringify(RECORDS), JSON.stringify(build()));
  assert("the class is flagged for the ruleset", ctx.isAnimalCompanionCharacter({ data: { classes: RECORDS.class } }), true);
  assert("companion ancestries have no boosts or flaws", RECORDS.ancestry.every((a) => Object.keys(a.data.boosts).length === 0 && Object.keys(a.data.flaws).length === 0), true);
  assert("every record has a portrait", [...RECORDS.ancestry, ...RECORDS.class, ...RECORDS.feats].every((r) => r.portrait), true);
}

section("A young bear at 1st level (Player Core pg. 206)");
{
  const bear = companion("Bear", 1);
  const d = bear.data;
  assert("Small, 16 HP (8 + (6 + 2) x 1), AC 15", [d.size, d.hitpoints, d.ac], ["small", 16, 15]);
  assert("Str +3, Dex +2, Con +2, Int -4, Wis +1, Cha +0", [d.strMod, d.dexMod, d.conMod, d.intMod, d.wisMod, d.chaMod], [3, 2, 2, -4, 1, 0]);
  assert("trained saves and Perception: Fort 5, Ref 5, Will 4, Perception 4", [d.fortitudeMod, d.reflexMod, d.willMod, d.perceptionMod], [5, 5, 4, 4]);
  assert("Acrobatics 5, Athletics 6, its Intimidation 3", [d.acrobaticsMod, d.athleticsMod, d.intimidationMod], [5, 6, 3]);
  assert("its jaws and claw, granted", d.inventory.map((i) => i.name), ["Jaws", "Claw"]);
  assert("jaws +6 for 1d8+3 piercing", [strike(bear, "Jaws").bonus, strike(bear, "Jaws").damage], [6, "1d8+3 piercing"]);
  assert("the Support action; no advanced maneuver yet", d.actions.map((a) => a.name), ["Support"]);
  assertIncludes("scent", d.senses, "scent (imprecise, 30 feet)");
  assert("no attribute boosts at 5th", ctx.getLevelUpGains(bear, 5, {}).boostCount, 0);
}

section("Mature (Player Core pg. 211)");
{
  const bear = companion("Bear", 4, ["Mature Animal Companion"]);
  const d = bear.data;
  assert("grows to Medium; 44 HP; AC 19", [d.size, d.hitpoints, d.ac], ["medium", 44, 19]);
  assert("expert saves and Perception: Fort 11, Ref 11, Will 10, Perception 10", [d.fortitudeMod, d.reflexMod, d.willMod, d.perceptionMod], [11, 11, 10, 10]);
  assert("Intimidation (its type's) expert; Stealth and Survival trained", [d.intimidation, d.intimidationMod, d.stealth, d.stealthMod, d.survival, d.survivalMod], ["2", 8, "1", 9, "1", 8]);
  assert("jaws +10 for 2d8+4", [strike(bear, "Jaws").bonus, strike(bear, "Jaws").damage], [10, "2d8+4 piercing"]);
  assert("claw 2d6 too", strike(bear, "Claw").damage, "2d6+4 slashing");
  const horse = companion("Horse", 4, ["Mature Animal Companion"], { size: "large" });
  assert("a Large horse doesn't grow", horse.data.size, "large");
}

section("Savage and nimble (Player Core pg. 211)");
{
  const bear = companion("Bear", 7, ["Mature Animal Companion", "Savage Animal Companion"]);
  const d = bear.data;
  assert("savage grows again: Large; 78 HP", [d.size, d.hitpoints], ["large", 78]);
  assert("Str 6, Dex 4, Con 4, Wis 3", [d.strMod, d.dexMod, d.conMod, d.wisMod], [6, 4, 4, 3]);
  assert("Athletics expert: 17", [d.athletics, d.athleticsMod], ["2", 17]);
  const jaws = strike(bear, "Jaws");
  assert("jaws +15 for 2d8+9 (Str 6 + 3), magical", [jaws.bonus, jaws.damage, jaws.traits.includes("Magical")], [15, "2d8+9 piercing", true]);
  assert("learns Bear Hug", d.actions.map((a) => a.name), ["Support", "Bear Hug"]);

  const wolf = companion("Wolf", 7, ["Mature Animal Companion", "Nimble Animal Companion"]);
  const w = wolf.data;
  assert("a nimble wolf stays Medium", w.size, "medium");
  assert("Acrobatics expert", w.acrobatics, "2");
  const bite = strike(wolf, "Jaws");
  assert("finesse jaws use Dex: +15 for 2d8+6 (Str 4 + 2), magical", [bite.bonus, bite.damage, bite.traits.includes("Magical")], [15, "2d8+6 piercing", true]);
  assert("learns Takedown", w.actions.map((a) => a.name), ["Support", "Takedown"]);
}

section("Specialized (Player Core pg. 211)");
{
  const bear = companion("Bear", 14, ["Mature Animal Companion", "Savage Animal Companion", "Specialized Animal Companion", "Bully"]);
  const d = bear.data;
  assert("Dex +1, Int +2, and the bully's Str +1, Cha +3", [d.strMod, d.dexMod, d.intMod, d.chaMod], [7, 5, -2, 3]);
  assert("master saves and Perception: Fort 24, Perception 23", [d.fortitudeMod, d.perceptionMod], [4 + 6 + 14, 3 + 6 + 14]);
  assert("Intimidation was expert from its type: master", d.intimidation, "3");
  assert("Athletics was expert from savage: stays expert", d.athletics, "2");
  const jaws = strike(bear, "Jaws");
  assert("expert unarmed, three dice, extra damage 3 -> 6: jaws +25 for 3d8+13", [jaws.bonus, jaws.damage], [7 + 4 + 14, "3d8+13 piercing"]);

  const racer = companion("Wolf", 14, ["Mature Animal Companion", "Nimble Animal Companion", "Specialized Animal Companion", "Racer"]);
  assert("racer: legendary Fortitude", racer.data.fortitude, "4");
}

process.exitCode = summary() > 0 ? 1 : 0;
