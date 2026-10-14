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
const FATIGUED = condition("fa", "Fatigued", [
  { type: "armorClassPenalty-status", field: "", valueType: "number", value: "1" },
  { type: "savePenalty-status", field: "all", valueType: "number", value: "1" },
]);

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

  // Without an ancestry Speed the sheet's own Speed is the base: it must not
  // take the penalty again on every recalculation
  const noAncestry = pc(2, plate());
  noAncestry.data.ancestries = [];
  const recalc = (record) => {
    const written = {};
    ctx.updateAttribute({ record, attribute: "str", value: record.data.str, moreValuesToSet: written });
    Object.entries(written).forEach(([key, value]) => {
      if (key.startsWith("data.")) record.data[key.slice(5)] = value;
    });
    return record.data.speed;
  };
  assert("no ancestry Speed: 25 -> 15", recalc(noAncestry), "15 feet");
  assert("and it stays 15 on the next recalculation", recalc(noAncestry), "15 feet");
  noAncestry.data.speed = "30 feet";
  assert("a Speed typed by hand becomes the base", recalc(noAncestry), "20 feet");
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

  // A rule whose field names AC itself (Imperial Blood Magic's choice)
  const IMPERIAL = condition("ib", "Imperial Blood Magic", [{ type: "allBonus-status", field: "data.effects.defense", valueType: "number", value: "1" }]);
  const realGet = ctx.api.getValueOnRecord;
  ctx.api.getValueOnRecord = (rec, path) => path.split(".").reduce((o, k) => o?.[k], rec);
  assert("Imperial Blood Magic AC choice: +1", ctx.getArmorClassForToken(npcToken({ ac: 20, effects: { defense: "ac" } }, [[IMPERIAL, 1]])), 21);
  assert("Imperial Blood Magic saves choice: AC unchanged", ctx.getArmorClassForToken(npcToken({ ac: 20, effects: { defense: "saving-throw" } }, [[IMPERIAL, 1]])), 20);
  ctx.api.getValueOnRecord = realGet;
}

section("only the strongest bonus or penalty of a type counts");
{
  const mods = (conditions, types, field) => ctx.getEffectsAndModifiersForToken(npcToken({}, conditions), types, field).map((m) => parseInt(m.value, 10));
  const SICKENED = condition("si", "Sickened", FRIGHTENED.rules);
  assert("frightened 2 beats sickened 1", mods([[FRIGHTENED, 2], [SICKENED, 1]], ["allPenalty"], "all").join(), "-2");
  const big = condition("bb", "Big Bonus", [{ type: "allBonus-status", field: "all", valueType: "string", value: "10" }]);
  const small = condition("sb", "Small Bonus", [{ type: "allBonus-status", field: "all", valueType: "string", value: "2" }]);
  assert("a +10 status bonus beats +2", mods([[big, 1], [small, 1]], ["allBonus"], "all").join(), "10");
  const plus2 = condition("p2", "Plus Two", [{ type: "allBonus-status", field: "all", valueType: "number", value: "+2" }]);
  const plus1 = condition("p1", "Plus One", [{ type: "allBonus-status", field: "all", valueType: "number", value: "1" }]);
  assert("a \"+2\" status bonus beats +1", mods([[plus2, 1], [plus1, 1]], ["allBonus"], "all").join(), "2");
  assert("in either order", mods([[plus1, 1], [plus2, 1]], ["allBonus"], "all").join(), "2");
  const d4 = condition("d4", "D4", [{ type: "damageBonus-status", field: "all", valueType: "string", value: "1d4" }]);
  const d8 = condition("d8", "D8", [{ type: "damageBonus-status", field: "all", valueType: "string", value: "1d8" }]);
  const dice = (conds) => ctx.getEffectsAndModifiersForToken(npcToken({}, conds), ["damageBonus"], "all").map((m) => m.value).join();
  assert("1d8 beats 1d4", dice([[d4, 1], [d8, 1]]), "1d8");
  assert("in either order", dice([[d8, 1], [d4, 1]]), "1d8");
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
  assert("fatigued and frightened 2 are both status: only -2", dc("fortitude", [[FATIGUED, 1], [FRIGHTENED, 2]]), 18);
  assert("fatigued and frightened 1: only -1", dc("fortitude", [[FATIGUED, 1], [FRIGHTENED, 1]]), 19);

  // The save roll prompt gets the same: one status penalty, the worst
  let rolled = null;
  ctx.api.promptRoll = (name, dice, modifiers) => {
    rolled = modifiers;
  };
  const pcSaver = { ...npcToken({ fortitudeMod: 10, fortitude: "1" }, [[FATIGUED, 1], [FRIGHTENED, 2]]), recordType: "characters" };
  ctx.record = pcSaver;
  ctx.rollSave(pcSaver, "fortitude");
  const statusPenalties = (rolled || []).filter((m) => m.type === "status" && parseInt(m.value, 10) < 0).map((m) => `${m.name} ${m.value}`);
  assert("save roll: only frightened 2 among status penalties", statusPenalties.join(), "Frightened -2");
  ctx.api.promptRoll = () => {};
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

  // Run the spell attack macro and read the modifiers it hands to the roll
  // prompt: the casting attribute's conditions and attack bonuses must reach it
  const attackSpell = { name: "Ray", data: { defense: { passive: { statistic: "ac" } }, traits: [], damage: [] } };
  const SPELL_STATUS = condition("ss", "Spell Focus", [{ type: "spellAttackBonus-status", field: "", valueType: "number", value: "1" }]);
  const attackRollMods = (record) => {
    const macro = ctx.getSpellAttackMacro(record, attackSpell, entry, "data.spells.0", null);
    const body = String(macro).replace(/^```Roll_Attack\n/, "").replace(/```\s*$/, "");
    const saved = { ...ctx.api };
    let captured = null;
    ctx.api.getRecord = (type, id, cb) => cb(record);
    ctx.api.getValueOnRecord = (r, path) => (path === "data.spells.0" ? attackSpell : null);
    ctx.api.getTargets = () => [];
    ctx.api.promptRoll = (name, dice, modifiers) => {
      captured = modifiers;
    };
    try {
      new vm.Script(body, { filename: "spell-attack-macro.js" }).runInContext(ctx);
    } finally {
      Object.assign(ctx.api, saved);
    }
    return (captured || [])
      .filter((m) => m.name !== "Spell Attack")
      .map((m) => `${m.name} ${m.value}`)
      .sort()
      .join(", ");
  };
  assert("no conditions: only the base spell attack", attackRollMods(caster([])), "");
  assert("frightened 2 reaches the spell attack roll", attackRollMods(caster([[FRIGHTENED, 2]])), "Frightened -2");
  assert("bless and stupefied reach a Charisma spell attack roll, enfeebled doesn't", attackRollMods(caster([[BLESS, 1], [STUPEFIED, 1], [ENFEEBLED, 1]])), "Bless 1, Stupefied -1");
  assert("a status spell attack bonus and bless: only one status bonus", attackRollMods(caster([[BLESS, 1], [SPELL_STATUS, 1]])).split(", ").length, 1);
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
  assert("largest type has its own resistance: 10 fire + 6 slash vs fire 5 + all 5 -> 6", dealt(target({ resistances: [w("fire", 5), w("all damage", 5)] }), [["fire", 10], ["slashing", 6]]), 6);
  assert("largest type has its own weakness: 10 fire + 6 slash vs fire 5 + all 3 -> 24", dealt(target({ weaknesses: [w("fire", 5), w("all damage", 3)] }), [["fire", 10], ["slashing", 6]]), 24);
  assert("same in the other order -> 24", dealt(target({ weaknesses: [w("fire", 5), w("all damage", 3)] }), [["slashing", 10], ["fire", 6]]), 24);
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
