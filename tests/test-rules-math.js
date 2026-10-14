// Tests for rules-math fixes: armor Speed penalties, condition penalties on AC,
// save DCs and spell DCs, stacking, Strike attack and damage stacking, Elite
// and Weak HP, resilient and potency runes and investiture, shields in
// inventory row 0, the hazard Stealth DC field, and the level -1 DC. They
// follow Foundry's PF2e. Weaknesses and resistances stay per damage type, as
// Foundry's PF2e applies them (tests/test-iwr.js).

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
const OFF_GUARD = condition("og", "Off-Guard", [{ type: "armorClassPenalty-circumstance", field: "", valueType: "number", value: "2" }]);
// A rule whose field names AC or saving throws (Imperial Blood Magic's choice)
const IMPERIAL = condition("ib", "Imperial Blood Magic", [{ type: "allBonus-status", field: "data.effects.defense", valueType: "number", value: "1" }]);
const resolvePath = (rec, path) => path.split(".").reduce((o, k) => o?.[k], rec);

function npcToken(data, conditions = []) {
  const effects = [];
  const effectIds = [];
  conditions.forEach(([effect, count]) => {
    effects.push(effect);
    for (let i = 0; i < count; i++) effectIds.push(effect._id);
  });
  return { _id: "npc", recordType: "npcs", identified: true, effects, effectIds, data: { level: 3, ...data } };
}

// A player character with the given conditions
function pcWith(data, conditions = []) {
  return { ...npcToken({ level: 1, str: 0, dex: 0, inventory: [], ...data }, conditions), _id: "pc", recordType: "characters", fields: {} };
}

// The modifiers the next api.promptRoll gets, and its metadata
function capturePrompt(run) {
  const saved = ctx.api.promptRoll;
  let captured = { modifiers: [], metadata: {} };
  ctx.api.promptRoll = (name, dice, modifiers, metadata) => {
    captured = { modifiers: modifiers || [], metadata: metadata || {} };
  };
  try {
    run();
  } finally {
    ctx.api.promptRoll = saved;
  }
  return captured;
}
const listMods = (mods) =>
  mods
    .map((m) => `${m.name} ${m.value}`)
    .sort()
    .join(", ");

section("armor Speed penalties");
{
  const plate = (extra = {}) => ({
    _id: "plate",
    name: "Full Plate",
    data: { type: "armor", carried: "equipped", acBonus: 6, speedPenalty: -10, strength: 4, checkPenalty: -3, ...extra },
  });
  const towerShield = { _id: "ts", name: "Tower Shield", data: { type: "shield", carried: "equipped", acBonus: 2, speedPenalty: -5 } };
  const pc = (str, armor, speed = "25 feet") => ({
    _id: "pc",
    recordType: "characters",
    data: { level: 1, str, dex: 0, speed, ancestries: [{ data: { speed } }], inventory: [].concat(armor) },
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

  // The Strength reduction stops at 0 before the shield's penalty is added
  assert("-3 armor with the Strength met, and a tower shield: 25 -> 20", speedWith(pc(4, [plate({ speedPenalty: -3 }), towerShield])), "20 feet");
  // Every Speed penalty stops at 5 feet, not only the armor's
  const SLOWED = condition("sp", "Speed Penalty", [{ type: "speedPenalty-status", field: "", valueType: "number", value: "10" }]);
  const slowed = { ...pc(0, [], "10 feet"), effects: [SLOWED], effectIds: ["sp"] };
  assert("a -10 status Speed penalty on a 10-foot Speed: 5 feet", speedWith(slowed), "5 feet");
  // Hindering: a separate 5 feet that meeting the Strength doesn't remove
  assert("hindering armor with the Strength met: 25 -> 20", speedWith(pc(4, plate({ speedPenalty: -5, traits: ["hindering"] }))), "20 feet");

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
}

section("armor check penalty");
{
  const character = (str) => ({ recordType: "characters", data: { str } });
  const fullPlate = { armor: { checkPenalty: -3, strength: 18 } };
  assert("legacy score below the requirement keeps the check penalty", ctx.getCheckPenaltyForArmor(character(3), fullPlate)?.[0]?.value, -3);
  assert("legacy score met removes it", ctx.getCheckPenaltyForArmor(character(4), fullPlate), null);
  assert("NPCs take none: their skills include it", ctx.getCheckPenaltyForArmor({ recordType: "npcs", data: { str: 0 } }, fullPlate), null);
  assert("armor without a check penalty adds no entry", ctx.getCheckPenaltyForArmor(character(-1), { armor: { checkPenalty: 0, strength: 1 } }), null);
  const penalty = ctx.getCheckPenaltyForArmor(character(3), fullPlate)?.[0];
  assert("untyped, with slug armor-check-penalty", `${penalty?.type}|${penalty?.slug}`, "|armor-check-penalty");

  // Untyped, so it stacks with an item penalty to the same skill (shoddy)
  const SHODDY = condition("sh", "Shoddy", [{ type: "skillPenalty-item", field: "", valueType: "number", value: "2" }]);
  const leather = { _id: "la", name: "Leather Armor", data: { type: "armor", carried: "equipped", acBonus: 1, checkPenalty: -1, strength: 1 } };
  const wearer = pcWith({ inventory: [leather] }, [[SHODDY, 1]]);
  const { modifiers } = capturePrompt(() => ctx.rollSkill(wearer, "athletics"));
  assert("check penalty -1 and shoddy -2 both apply", listMods(modifiers.filter((m) => parseInt(m.value, 10) < 0)), "Check Penalty -1, Shoddy -2");
}

section("sheet AC and effects of the same type");
{
  const shieldOfFaith = { _id: "sf", name: "Ward", data: { modifiers: [{ data: { type: "armorClassBonus", modifierType: "item", valueType: "number", value: "1" } }] } };
  const mysticArmor = condition("ma", "Mystic Armor", [{ type: "armorClassBonus-item", field: "", valueType: "number", value: "2" }]);
  const pc = (withFeature, conditions = []) => {
    const token = { ...npcToken({ level: 1, dex: 0, inventory: [], feats: withFeature ? [shieldOfFaith] : [] }, conditions), recordType: "characters" };
    const written = {};
    ctx.updateAttribute({ record: token, attribute: "dex", value: 0, moreValuesToSet: written });
    token.data.ac = written["data.ac"];
    return token;
  };
  const without = pc(false).data.ac;
  const withFeature = pc(true).data.ac;
  assert("the feature's +1 is on the sheet", withFeature - without, 1);
  assert("the sheet keeps it while a bigger effect is active", pc(true, [[mysticArmor, 1]]).data.ac, withFeature);
  assert("token AC: the +2 effect replaces the +1 feature", ctx.getArmorClassForToken(pc(true, [[mysticArmor, 1]])), without + 2);
  assert("token AC without the effect: the feature's +1", ctx.getArmorClassForToken(pc(true)), without + 1);
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

  const realGet = ctx.api.getValueOnRecord;
  ctx.api.getValueOnRecord = resolvePath;
  assert("Imperial Blood Magic AC choice: +1", ctx.getArmorClassForToken(npcToken({ ac: 20, effects: { defense: "ac" } }, [[IMPERIAL, 1]])), 21);
  assert("Imperial Blood Magic saves choice: AC unchanged", ctx.getArmorClassForToken(npcToken({ ac: 20, effects: { defense: "saving-throw" } }, [[IMPERIAL, 1]])), 20);
  ctx.api.getValueOnRecord = realGet;

  // A character's sheet AC leaves effects out; the token AC adds them once
  const fatiguedPc = pcWith({ speed: "25 feet", ancestries: [{ data: { speed: "25 feet" } }] }, [[FATIGUED, 1]]);
  const written = {};
  ctx.updateAttribute({ record: fatiguedPc, attribute: "dex", value: 0, moreValuesToSet: written });
  assert("fatigued character: sheet AC 10", written["data.ac"], 10);
  assert("and token AC 9: fatigued counts once", ctx.getArmorClassForToken({ ...fatiguedPc, data: { ...fatiguedPc.data, ac: written["data.ac"] } }), 9);

  // Flanking makes the target off-guard: -2 circumstance, which doesn't stack
  // with a circumstance penalty it already has
  const MINUS_ONE = condition("m1", "Minor Hindrance", [{ type: "armorClassPenalty-circumstance", field: "", valueType: "number", value: "1" }]);
  const flanked = (conditions) => ctx.getArmorClassForToken(npcToken({ ac: 20 }, conditions), true);
  assert("flanked: 18", flanked([]), 18);
  assert("flanked and already off-guard: still 18", flanked([[OFF_GUARD, 1]]), 18);
  assert("flanked with a -1 circumstance penalty: 18", flanked([[MINUS_ONE, 1]]), 18);
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

  // Dice always stack, and persistent damage stacks apart from the rest
  const d4 = condition("d4", "D4", [{ type: "damageBonus-status", field: "all", valueType: "string", value: "1d4" }]);
  const d8 = condition("d8", "D8", [{ type: "damageBonus-status", field: "all", valueType: "string", value: "1d8" }]);
  const two = condition("t2", "Two", [{ type: "damageBonus-status", field: "all", valueType: "string", value: "2" }]);
  const persistent = condition("pf", "Persistent Fire", [{ type: "damageBonus-status", field: "all", valueType: "string", value: "1 fire-persistent" }]);
  const damage = (conds) =>
    ctx
      .getEffectsAndModifiersForToken(npcToken({}, conds), ["damageBonus"], "all")
      .map((m) => m.value)
      .sort()
      .join();
  assert("status 1d4 and 1d8 both apply", damage([[d4, 1], [d8, 1]]), "1d4,1d8");
  assert("in either order", damage([[d8, 1], [d4, 1]]), "1d4,1d8");
  assert("status 1d4 and +2 both apply", damage([[d4, 1], [two, 1]]), "1d4,2");
  assert("status +2 and 1 persistent fire both apply", damage([[two, 1], [persistent, 1]]), "1 fire-persistent,2");

  // The value's sign picks the bonus or penalty pool, not the rule's name
  const raised = { name: "Raised", type: "status", modifierType: "allPenalty", value: 2, active: true };
  const bonus = { name: "Bonus", type: "status", modifierType: "allBonus", value: 1, active: true };
  assert("a penalty raised to +2 is a bonus: it beats a +1 status bonus", listMods(ctx.keepStrongestPerType([raised, bonus])), "Raised 2");
  const untyped = (name, value) => ({ name, type: "untyped", modifierType: "saveBonus", value, active: true });
  assert("type \"untyped\" stacks", listMods(ctx.keepStrongestPerType([untyped("A", 1), untyped("B", 2)])), "A 1, B 2");

  // A feature's penalty stored as a positive number is still a penalty
  const feat = (type, value) => ({ name: "Heavy Gear", data: { modifiers: [{ data: { type, modifierType: "item", valueType: "number", value, field: "" } }] } });
  const featured = (type, value) => ({ recordType: "characters", data: { level: 1, feats: [feat(type, value)] } });
  assert("a feature's skill penalty of 2 is -2", ctx.getEffectsAndModifiersForToken(featured("skillPenalty", "2"), ["skillPenalty"], "athletics").map((m) => m.value).join(), "-2");
  assert("ignore range penalty stays positive", ctx.getEffectsAndModifiersForToken(featured("ignoreRangePenalty", "1"), ["ignoreRangePenalty"]).map((m) => m.value).join(), "1");
}

section("a formula penalty stays a penalty");
{
  const npc = npcToken({ level: 5 }, [
    [condition("cr", "Cringe", [{ type: "damagePenalty-circumstance", field: "all", valueType: "string", value: "(2 + @record.data.level)" }]), 1],
    [condition("db", "Damage Bonus", [{ type: "damageBonus-circumstance", field: "all", valueType: "number", value: "2" }]), 1],
  ]);
  const mods = ctx.getEffectsAndModifiersForToken(npc, ["damageBonus", "damagePenalty"], "all");
  assert("both the circumstance bonus and the formula penalty apply", mods.map((m) => m.name).sort(), ["Cringe", "Damage Bonus"]);
  assert("the formula is read as -7", ctx.getModifierSortValue({ value: "-(2 + 5)" }), -7);
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
  assert("an NPC's bonus to all saves raises its save DCs", ctx.getSaveDCForToken(npcToken({ fortitudeMod: 10, saveBonus: 2 }), "fortitude"), 22);

  // The save roll prompt gets the same: one status penalty, the worst
  const pcSaver = { ...npcToken({ fortitudeMod: 10, fortitude: "1" }, [[FATIGUED, 1], [FRIGHTENED, 2]]), recordType: "characters" };
  ctx.record = pcSaver;
  const rolled = capturePrompt(() => ctx.rollSave(pcSaver, "fortitude")).modifiers;
  const statusPenalties = rolled.filter((m) => m.type === "status" && parseInt(m.value, 10) < 0).map((m) => `${m.name} ${m.value}`);
  assert("save roll: only frightened 2 among status penalties", statusPenalties.join(), "Frightened -2");

  // Imperial Blood Magic's saves choice reaches save DCs and save rolls
  const realGet = ctx.api.getValueOnRecord;
  ctx.api.getValueOnRecord = resolvePath;
  const imperial = (defense) => npcToken({ fortitudeMod: 10, effects: { defense } }, [[IMPERIAL, 1]]);
  assert("Imperial Blood Magic saves choice: Fortitude DC 21", ctx.getSaveDCForToken(imperial("saving-throw"), "fortitude"), 21);
  assert("Imperial Blood Magic AC choice: Fortitude DC unchanged", ctx.getSaveDCForToken(imperial("ac"), "fortitude"), 20);
  const imperialRoll = capturePrompt(() => ctx.rollSave(imperial("saving-throw"), "fortitude")).modifiers;
  assert("and +1 on the save roll", imperialRoll.filter((m) => m.name === "Imperial Blood Magic").map((m) => m.value).join(), "1");
  ctx.api.getValueOnRecord = realGet;
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

section("Strike attack and damage rolls");
{
  // A Dex-based finesse Strike with a +1 potency rune
  const rapier = (traits = ["finesse"]) => ({
    _id: "w",
    name: "Rapier",
    data: { type: "weapon", carried: "equipped", itemCategory: "martial", group: "sword", traits, damage: { dice: 1, die: "d6", damageType: "piercing" }, runes: { potency: 1 } },
  });
  const striker = (conditions, weapon = rapier()) => pcWith({ dex: 3, inventory: [weapon] }, conditions);
  const attack = (record, attackNumber = 1) => capturePrompt(() => ctx.performAttackRoll(record, record.data.inventory[0], "data.inventory.0", attackNumber));
  const named = (mods, name) => mods.find((m) => m.name === name);

  // The melee and Dex lookups each bring a status penalty: only the worse applies
  const scared = striker([[FRIGHTENED, 1], [CLUMSY, 2]]);
  assert("frightened 1 and clumsy 2 on a Dex Strike: only -2", listMods(attack(scared).modifiers.filter((m) => m.type === "status")), "Clumsy -2");
  const realTargets = ctx.api.getTargets;
  ctx.api.getTargets = () => [{ token: npcToken({ ac: 20 }), distance: 5 }];
  assert("with a target too", listMods(attack(scared).modifiers.filter((m) => m.type === "status")), "Clumsy -2");
  ctx.api.getTargets = realTargets;

  // The potency rune is an item bonus
  const MUTAGEN = condition("mu", "Mutagen", [{ type: "attackBonus-item", field: "all", valueType: "number", value: "2" }]);
  const bonuses = (mods) => listMods(mods.filter((m) => m.name === "Mutagen" || m.name === "Weapon Potency +1"));
  assert("+1 potency rune and a +2 item bonus: only +2", bonuses(attack(striker([[MUTAGEN, 1]])).modifiers), "Mutagen 2");
  assert("the potency rune alone: +1 item", listMods(attack(striker([])).modifiers.filter((m) => m.type === "item")), "Weapon Potency +1 1");
  // Automatic Bonus Progression's attack potency stacks with item bonuses
  const realSetting = ctx.api.getSetting;
  ctx.api.getSetting = (key) => (key === "automaticBonusProgression" ? "yes" : null);
  const abpStriker = { ...striker([[MUTAGEN, 1]]), data: { ...striker([]).data, level: 2 } };
  const abpBonuses = attack(abpStriker).modifiers.filter((m) => m.name === "Mutagen" || m.name === "Attack Potency +1");
  assert("ABP: attack potency +1 and a +2 item bonus both apply", listMods(abpBonuses), "Attack Potency +1 1, Mutagen 2");
  ctx.api.getSetting = realSetting;

  // Multiple attack penalty and the lethal option still reach the prompt
  const second = attack(striker([], rapier(["finesse", "nonlethal"])), 2).modifiers;
  assert("second attack: MAP -5", named(second, "Mutliple Attack Penalty")?.value, -5);
  assert("nonlethal: the lethal option, off, at -2", `${named(second, "Make Attack Lethal")?.active} ${named(second, "Make Attack Lethal")?.value}`, "false -2");
  const HAMPERED = condition("ha", "Hampered", [{ type: "attackPenalty-circumstance", field: "all", valueType: "number", value: "2" }]);
  const hampered = attack(striker([[HAMPERED, 1]], rapier(["finesse", "nonlethal"]))).modifiers;
  assert("already -2 circumstance: the lethal option adds 0", named(hampered, "Make Attack Lethal")?.value, 0);
  const SLIGHT = condition("sl", "Slight Hindrance", [{ type: "attackPenalty-circumstance", field: "all", valueType: "number", value: "1" }]);
  const slight = attack(striker([[SLIGHT, 1]], rapier(["finesse", "nonlethal"]))).modifiers;
  assert("already -1 circumstance: the lethal option adds -1", named(slight, "Make Attack Lethal")?.value, -1);

  // Damage: a status bonus to melee damage and one to Strength-based damage
  const RAGE = condition("ra", "Melee Fury", [{ type: "damageBonus-status", field: "melee", valueType: "number", value: "1" }]);
  const MIGHT = condition("mi", "Might", [{ type: "damageBonus-status", field: "str", valueType: "number", value: "2" }]);
  const brute = pcWith({ str: 1, inventory: [rapier([])] }, [[RAGE, 1], [MIGHT, 1]]);
  const damageBonuses = (mods) => listMods(mods.filter((m) => m.name === "Melee Fury" || m.name === "Might"));
  assert("attack's damage: two status damage bonuses, only +2", damageBonuses(attack(brute).metadata.damageModifiers || []), "Might 2");
  const rolled = capturePrompt(() => ctx.performDamageRoll(brute, brute.data.inventory[0], "data.inventory.0", false)).modifiers;
  assert("damage roll: only +2", damageBonuses(rolled), "Might 2");
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
  const adjust = (type, data) => {
    written = {};
    npcCtx.record = { _id: "n", recordType: "npcs", data: { hitpoints: 100, curhp: 100, ac: 20, perceptionMod: 5, fortitudeMod: 5, reflexMod: 5, willMod: 5, attacks: [], spells: [], skills: [], ...data }, fields: {} };
    npcCtx.applyAdjustment(type);
    return written;
  };
  const hpAfter = (type, level) => adjust(type, { level })["data.hitpoints"];
  assert("weak level 2: -10", hpAfter("weak", 2), 90);
  assert("weak level 5: -15", hpAfter("weak", 5), 85);
  assert("weak level 20: -20", hpAfter("weak", 20), 80);
  assert("weak level 21: -30", hpAfter("weak", 21), 70);
  assert("weak level 0: no change", hpAfter("weak", 0), 100);
  assert("weak level -1: no change", hpAfter("weak", -1), 100);
  assert("a level 0 creature keeps starting level 0", adjust("elite", { level: 0 })["data.baseLevel"], 0);
  assert("elite level 2: +15", hpAfter("elite", 2), 115);
  assert("elite level 20: +30", hpAfter("elite", 20), 130);

  // Switching or removing an adjustment keeps damage already taken: an Elite
  // level 5 creature (100 HP, now 120) that took 30 damage
  const damagedElite = { level: 6, baseLevel: 5, hitpoints: 120, baseHP: 100, curhp: 90, baseCurHP: 100, adjustment: "elite" };
  assert("elite to weak: 90 - 20 - 15 = 55", adjust("weak", damagedElite)["data.curhp"], 55);
  assert("and max HP 85", written["data.hitpoints"], 85);
  assert("elite removed: 90 - 20 = 70", adjust("remove", damagedElite)["data.curhp"], 70);
  assert("weak can take current HP to 0", adjust("weak", { level: 5, curhp: 10 })["data.curhp"], 0);

  // An NPC made Weak by an older version (-10 at level 0) gets back what it lost
  const oldWeak = { level: -1, baseLevel: 0, hitpoints: 90, baseHP: 100, curhp: 90, baseCurHP: 100, adjustment: "weak" };
  assert("old Weak at level 0 removed: back to 100", adjust("remove", oldWeak)["data.curhp"], 100);

  // Max HP stops at 1, and current HP moves only as far as max HP did
  assert("weak on an 8 HP level 1 creature: 1 of 1, not 0", adjust("weak", { level: 1, hitpoints: 8, curhp: 8 })["data.curhp"], 1);
  const weakLow = { level: -1, baseLevel: 1, hitpoints: 1, baseHP: 8, curhp: 1, adjustment: "weak" };
  assert("and removing it gives back 8 of 8, not 11", adjust("remove", weakLow)["data.curhp"], 8);

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

section("resilient and potency runes need investment");
{
  const armored = (recordType, invested) => ({
    recordType,
    data: { inventory: [{ _id: "a", data: { type: "armor", carried: "equipped", acBonus: 4, runes: { potency: "1", resilient: "1" }, invested } }] },
  });
  const best = { armor: { armorId: "a" } };
  assert("invested: +1", ctx.getResilientArmorBonus(armored("characters", "true"), best)?.[0]?.value, 1);
  assert("not invested: nothing", ctx.getResilientArmorBonus(armored("characters", "false"), best), null);
  assert("NPCs: nothing, their saves include it", ctx.getResilientArmorBonus(armored("npcs", undefined), best), null);
  const armorAc = (record) => ctx.getBestEquippedArmor(record).armor.acBonus;
  assert("potency rune, invested: AC 4 + 1", armorAc(armored("characters", "true")), 5);
  assert("potency rune, not invested: AC 4", armorAc(armored("characters", "false")), 4);
  assert("NPCs don't invest: AC 4 + 1", armorAc(armored("npcs", undefined)), 5);
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
