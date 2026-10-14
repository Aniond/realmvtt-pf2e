// Tests for rules-math fixes: armor Speed penalties, condition penalties on AC,
// save DCs and spell DCs, weakness and resistance per damage instance, Weak HP,
// resilient runes and investiture, shields in inventory row 0, the hazard
// Stealth DC field, and the level -1 DC.

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
// The spell macros live in spells.js, which shares the ruleset's global scope
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// A module-style condition effect (value "@effect.count", stacked by effectIds)
const condition = (id, name, rules) => ({ _id: id, name, rules });
const FRIGHTENED = condition("fr", "Frightened", [{ type: "allPenalty-status", field: "all", valueType: "string", value: "@effect.count" }]);
const ENFEEBLED = condition("en", "Enfeebled", [{ type: "allPenalty-status", field: "str", valueType: "string", value: "@effect.count" }]);
const CLUMSY = condition("cl", "Clumsy", [{ type: "allPenalty-status", field: "dex", valueType: "string", value: "@effect.count" }]);
const DRAINED = condition("dr", "Drained", [{ type: "allPenalty-status", field: "con", valueType: "string", value: "@effect.count" }]);
const STUPEFIED = condition("st", "Stupefied", ["cha", "int", "wis"].map((field) => ({ type: "allPenalty-status", field, valueType: "string", value: "@effect.count" })));
const BLESS = condition("bl", "Bless", [{ type: "attackBonus-status", field: "all", valueType: "number", value: "1" }]);

function npcToken(data, conditions = []) {
  const effects = [];
  const effectIds = [];
  conditions.forEach(([effect, count]) => {
    effects.push(effect);
    for (let i = 0; i < count; i++) effectIds.push(effect._id);
  });
  return { _id: "npc", recordType: "npcs", identified: true, effects, effectIds, data: { level: 3, ...data } };
}

section("armor Speed penalties");
{
  const plate = (extra = {}) => ({
    _id: "plate",
    name: "Full Plate",
    data: { type: "armor", carried: "equipped", acBonus: 6, speedPenalty: -10, strength: 4, checkPenalty: -3, ...extra },
  });
  const pc = (str, armor, speed = "25 feet") => ({
    _id: "pc",
    recordType: "characters",
    data: { level: 1, str, dex: 0, speed, ancestries: [{ data: { speed } }], inventory: [armor] },
    fields: {},
  });
  const speedWith = (record) => {
    const written = {};
    ctx.updateAttribute({ record, attribute: "str", value: record.data.str, moreValuesToSet: written });
    return written["data.speed"] ?? record.data.speed;
  };
  assert("-10 armor without the Strength: 25 -> 15", speedWith(pc(2, plate())), "15 feet");
  assert("meeting the Strength reduces it by 5: 25 -> 20", speedWith(pc(4, plate())), "20 feet");
  assert("a positive penalty still works", speedWith(pc(2, plate({ speedPenalty: 10 }))), "15 feet");
  assert("legacy Strength score 18 counts as +4", speedWith(pc(4, plate({ strength: 18 }))), "20 feet");
  assert("penalties stop at 5 feet", speedWith(pc(0, plate(), "10 feet")), "5 feet");
  assert("unarmored is unchanged", speedWith(pc(0, { _id: "x", name: "Rope", data: { type: "equipment" } })), "25 feet");
  assert("legacy score below the requirement keeps the check penalty", ctx.getCheckPenaltyForArmor({ data: { str: 3 } }, { armor: { checkPenalty: -3, strength: 18 } })?.[0]?.value, -3);
  assert("legacy score met removes it", ctx.getCheckPenaltyForArmor({ data: { str: 4 } }, { armor: { checkPenalty: -3, strength: 18 } }), null);
}

section("conditions on AC");
{
  const ac = (conditions) => ctx.getArmorClassForToken(npcToken({ ac: 20 }, conditions));
  assert("no conditions: 20", ac([]), 20);
  assert("enfeebled 2 doesn't lower AC", ac([[ENFEEBLED, 2]]), 20);
  assert("stupefied 2 doesn't lower AC", ac([[STUPEFIED, 2]]), 20);
  assert("drained 2 doesn't lower AC", ac([[DRAINED, 2]]), 20);
  assert("clumsy 1 lowers AC", ac([[CLUMSY, 1]]), 19);
  assert("frightened 2 lowers AC", ac([[FRIGHTENED, 2]]), 18);
  assert("frightened 2 and clumsy 1 are both status: only the worse counts", ac([[FRIGHTENED, 2], [CLUMSY, 1]]), 18);
}

section("only the strongest bonus or penalty of a type counts");
{
  const mods = (conditions, types, field) => ctx.getEffectsAndModifiersForToken(npcToken({}, conditions), types, field).map((m) => parseInt(m.value, 10));
  const SICKENED = condition("si", "Sickened", FRIGHTENED.rules);
  assert("frightened 2 beats sickened 1", mods([[FRIGHTENED, 2], [SICKENED, 1]], ["allPenalty"], "all").join(), "-2");
  const big = condition("bb", "Big Bonus", [{ type: "allBonus-status", field: "all", valueType: "string", value: "10" }]);
  const small = condition("sb", "Small Bonus", [{ type: "allBonus-status", field: "all", valueType: "string", value: "2" }]);
  assert("a +10 status bonus beats +2", mods([[big, 1], [small, 1]], ["allBonus"], "all").join(), "10");
}

section("conditions on save DCs");
{
  const dc = (save, conditions) => ctx.getSaveDCForToken(npcToken({ fortitudeMod: 10, reflexMod: 10, willMod: 10 }, conditions), save);
  assert("Fortitude DC 20", dc("fortitude", []), 20);
  assert("frightened 2 lowers the Fortitude DC", dc("fortitude", [[FRIGHTENED, 2]]), 18);
  assert("drained 1 lowers the Fortitude DC", dc("fortitude", [[DRAINED, 1]]), 19);
  assert("drained 1 doesn't lower the Will DC", dc("will", [[DRAINED, 1]]), 20);
  assert("clumsy 1 lowers the Reflex DC", dc("reflex", [[CLUMSY, 1]]), 19);
  assert("stupefied 1 lowers the Will DC", dc("will", [[STUPEFIED, 1]]), 19);
  assert("enfeebled 2 changes no save DC", ["fortitude", "reflex", "will"].map((s) => dc(s, [[ENFEEBLED, 2]])).join(","), "20,20,20");
}

section("conditions on spell DCs and spell attacks");
{
  const caster = (conditions) => ({ ...npcToken({}, conditions), _id: "caster" });
  const entry = { data: { dc: 20, attribute: "cha", attack: 10 } };
  const spell = { name: "Fear", data: { defense: { save: { statistic: "will" } }, traits: [] } };
  const dcIn = (macro) => parseInt(String(macro).match(/(?:dc|DC)\D{0,6}(\d+)/)?.[1], 10);
  const base = dcIn(ctx.getSpellSaveMacro(caster([]), spell, entry, "data.spells.0"));
  assert("the macro carries the DC", base, 20);
  assert("frightened 2 lowers the spell DC", dcIn(ctx.getSpellSaveMacro(caster([[FRIGHTENED, 2]]), spell, entry, "data.spells.0")), 18);
  assert("stupefied 1 lowers a Charisma caster's DC", dcIn(ctx.getSpellSaveMacro(caster([[STUPEFIED, 1]]), spell, entry, "data.spells.0")), 19);
  assert("enfeebled 2 doesn't", dcIn(ctx.getSpellSaveMacro(caster([[ENFEEBLED, 2]]), spell, entry, "data.spells.0")), 20);

  // The spell attack macro gathers the casting attribute's modifiers when run
  const attackSpell = { name: "Ray", data: { defense: { passive: { statistic: "ac" } }, traits: [], damage: [] } };
  const macro = ctx.getSpellAttackMacro(caster([]), attackSpell, entry, "data.spells.0", null);
  assert("spell attacks gather attack and attribute modifiers", /spellCheckMods[\s\S]*"attackBonus", "attackPenalty", "allBonus", "allPenalty"[\s\S]*"cha"/.test(macro), true);
  const mods = ctx.getEffectsAndModifiersForToken(caster([[BLESS, 1], [STUPEFIED, 1], [ENFEEBLED, 1]]), ["attackBonus", "attackPenalty", "allBonus", "allPenalty"], "cha");
  assert("bless and stupefied apply to a Charisma spell attack, enfeebled doesn't", mods.map((m) => `${m.name} ${m.value}`).sort().join(", "), "Bless 1, Stupefied -1");
}

section("weakness and resistance once per instance");
{
  const START = 1000;
  const target = (data) => ({ _id: "t", recordType: "npcs", name: "T", record: { name: "T" }, identified: true, effects: [], data: { curhp: START, hitpoints: START, ...data } });
  const dealt = (t, pairs, categories = []) => {
    ctx.__state.lastSet = null;
    ctx.applyDamage(
      t,
      {
        types: pairs.map(([type, value]) => ({ die: 6, value, type })),
        dice: pairs.map(([, value]) => ({ type: 6, value })),
        total: pairs.reduce((s, [, v]) => s + v, 0),
        metadata: { traits: [], damageCategories: categories, damageType: pairs[0][0] },
      },
      false,
      null,
      false,
    );
    const set = ctx.__state.lastSet || {};
    return START - ("data.curhp" in set ? set["data.curhp"] : START);
  };
  const w = (type, value) => ({ data: { type, value } });
  assert("cold iron weakness 5 on slashing + fire: 21", dealt(target({ weaknesses: [w("cold-iron", 5)] }), [["slashing", 10], ["fire", 6]], ["cold-iron"]), 21);
  assert("all-damage weakness 3 on two types: 19", dealt(target({ weaknesses: [w("all damage", 3)] }), [["slashing", 10], ["fire", 6]]), 19);
  assert("fire and slashing weaknesses both apply: 26", dealt(target({ weaknesses: [w("fire", 5), w("slashing", 5)] }), [["slashing", 10], ["fire", 6]]), 26);
  assert("all-damage resistance 5 on one type of the split: 11", dealt(target({ resistances: [w("all damage", 5)] }), [["slashing", 10], ["fire", 6]]), 11);
  assert("it goes to the larger type: 3 slashing + 10 fire -> 8", dealt(target({ resistances: [w("all damage", 5)] }), [["slashing", 3], ["fire", 10]]), 8);
  assert("fire resistance plus all-damage resistance: 10 slash + 6 fire -> 6", dealt(target({ resistances: [w("fire", 5), w("all damage", 5)] }), [["slashing", 10], ["fire", 6]]), 6);
  assert("single type unchanged: all-damage resistance 5 on 10 fire -> 5", dealt(target({ resistances: [w("all damage", 5)] }), [["fire", 10]]), 5);
}

section("Weak and Elite HP");
{
  const sheet = fs.readFileSync(`${__dirname}/../npcs-main.html`, "utf8");
  const npcCtx = createSandbox();
  new vm.Script(sheet.match(/<script>([\s\S]*?)<\/script>/)[1], { filename: "npcs-main.html" }).runInContext(npcCtx);
  let written = {};
  npcCtx.api.setValues = (values) => {
    written = values;
  };
  const hpAfter = (type, level) => {
    written = {};
    npcCtx.record = { _id: "n", recordType: "npcs", data: { level, hitpoints: 100, curhp: 100, ac: 20, perceptionMod: 5, fortitudeMod: 5, reflexMod: 5, willMod: 5, attacks: [], spells: [], skills: [] }, fields: {} };
    npcCtx.applyAdjustment(type);
    return written["data.hitpoints"];
  };
  assert("weak level 2: -10", hpAfter("weak", 2), 90);
  assert("weak level 5: -15", hpAfter("weak", 5), 85);
  assert("weak level 20: -20", hpAfter("weak", 20), 80);
  assert("weak level 21: -30", hpAfter("weak", 21), 70);
  assert("elite level 2: +15", hpAfter("elite", 2), 115);
  assert("elite level 20: +30", hpAfter("elite", 20), 130);

  // Hazard Stealth DC typed into the old field moves to data.stealth.value
  written = {};
  npcCtx.record = { data: { sealth: { value: 22 }, stealth: { details: "trained" } } };
  npcCtx.onHazardStealthLoad();
  assert("typed DC moves to stealth.value", written["data.stealth.value"], 22);
  assert("and the old field is cleared", written["data.sealth"], null);
  written = {};
  npcCtx.record = { data: { sealth: { value: 22 }, stealth: { value: 25 } } };
  npcCtx.onHazardStealthLoad();
  assert("an imported DC wins", written["data.stealth.value"], undefined);
  written = {};
  npcCtx.record = { data: { stealth: { value: 25 } } };
  npcCtx.onHazardStealthLoad();
  assert("nothing to move: no write", Object.keys(written).length, 0);
}

section("resilient runes need investment");
{
  const armored = (recordType, invested) => ({
    recordType,
    data: { inventory: [{ _id: "a", data: { type: "armor", runes: { resilient: "1" }, invested } }] },
  });
  const best = { armor: { armorId: "a" } };
  assert("invested: +1", ctx.getResilientArmorBonus(armored("characters", "true"), best)?.[0]?.value, 1);
  assert("not invested: nothing", ctx.getResilientArmorBonus(armored("characters", "false"), best), null);
  assert("NPCs don't invest", ctx.getResilientArmorBonus(armored("npcs", undefined), best)?.[0]?.value, 1);
}

section("shield in inventory row 0");
{
  const sheet = fs.readFileSync(`${__dirname}/../characters-main.html`, "utf8");
  const pcCtx = createSandbox();
  new vm.Script(sheet.match(/<script>([\s\S]*?)<\/script>/)[1], { filename: "characters-main.html" }).runInContext(pcCtx);
  let written = {};
  pcCtx.api.setValues = (values) => {
    written = values;
  };
  pcCtx.record = {
    recordType: "characters",
    data: { shieldBt: 5, inventory: [{ _id: "s", name: "Steel Shield", data: { type: "shield", carried: "equipped", hp: { value: 20, max: 20 } } }] },
    fields: {},
  };
  pcCtx.onChangeShieldHp(12);
  assert("HP edit reaches the shield in row 0", written["data.inventory.0.data.hp.value"], 12);
}

section("level -1 DC");
{
  assert("level -1: 13", ctx.getDCForLevel(-1), 13);
  assert("level 0: 14", ctx.getDCForLevel(0), 14);
}

process.exitCode = summary() > 0 ? 1 : 0;
