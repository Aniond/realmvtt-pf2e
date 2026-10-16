// Tests for feat automation support: degree-of-success worsening, math with
// min()/max(), number-valued resistances, AC and HP modifier fixes, persistent
// damage that honors its predicate, critical-hit-only damage riders, Foundry
// predicate atoms (item:base, target:*, skill ranks, armor), Foundry selectors
// as modifier fields, situational opt-in modifiers, weapon die and trait
// alterations, weapon dice tokens, other movement Speeds, senses, Dex caps,
// dying maximum and recovery DC modifiers, and save macro source traits.
// Run: node tests/test-feat-automation.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// --- helpers ----------------------------------------------------------------

// A feat carrying the given modifier data entries
const feat = (name, modifiers, extra = {}) => ({
  _id: `feat-${name}`,
  name,
  recordType: "feats",
  data: { type: "general", level: 1, modifiers: modifiers.map((data) => ({ data })), ...extra },
});

// A level 5 character with the given feats and inventory
function pc({ feats = [], inventory = [], ...data } = {}) {
  return {
    _id: "pc",
    recordType: "characters",
    effects: [],
    effectIds: [],
    fields: {},
    data: {
      level: 5,
      str: 2,
      dex: 3,
      con: 1,
      speed: "25 feet",
      ancestries: [{ name: "Human", data: { speed: "25 feet", hp: 8 } }],
      classes: [{ name: "Fighter", data: { hp: 10, features: [] } }],
      feats,
      bonusFeats: [],
      inventory,
      ...data,
    },
  };
}

const weapon = (name, extra = {}) => ({
  _id: `w-${name}`,
  name,
  recordType: "items",
  data: {
    type: "weapon",
    carried: "equipped",
    itemCategory: "martial",
    group: "sword",
    traits: [],
    usage: "held-in-one-hand",
    range: 0,
    damage: { dice: 1, die: "d8", damageType: "slashing" },
    runes: { potency: 0, striking: 0, property: [] },
    ...extra,
  },
});

function capturePrompt(run) {
  const saved = ctx.api.promptRoll;
  let captured = { modifiers: [], metadata: {}, dice: "" };
  ctx.api.promptRoll = (name, dice, modifiers, metadata) => {
    captured = { modifiers: modifiers || [], metadata: metadata || {}, dice };
  };
  try {
    run();
  } finally {
    ctx.api.promptRoll = saved;
  }
  return captured;
}

const lookup = (record, types, field, context = {}) =>
  ctx.getEffectsAndModifiersForToken(record, types, field, undefined, undefined, context);
const traitsFor = (record, context = {}) => [...ctx.collectTraitsAndProperties(record, context)];
const names = (mods) => mods.map((m) => m.name);

// --- degree of success ------------------------------------------------------

section("degree of success adjustments");
{
  const adjust = (degree, mods) => {
    const record = pc({ feats: [feat("Adjuster", mods)] });
    const adjustments = ctx.getDegreeOfSuccessAdjustments(record, ["will"]);
    return ctx.applyDegreeOfSuccessAdjustment(degree, adjustments).degree;
  };
  const ads = (adjustment) => ({ type: "adjustDegreeOfSuccess", field: "will", adjustment });
  assert("one-degree-better still turns a success into a critical success", adjust(1, [ads({ success: "one-degree-better" })]), 2);
  assert("one-degree-worse now applies: failure -> critical failure", adjust(0, [ads({ failure: "one-degree-worse" })]), -1);
  assert("two-degrees-worse applies to all", adjust(1, [ads({ all: "two-degrees-worse" })]), -1);
  assert("to-success applies: failure -> success", adjust(0, [ads({ failure: "to-success" })]), 1);
  assert("to-success applies: critical failure -> success", adjust(-1, [ads({ criticalFailure: "to-success" })]), 1);
  assert("to-failure applies: critical failure -> failure", adjust(-1, [ads({ criticalFailure: "to-failure" })]), 0);
  assert("to-critical-failure applies", adjust(1, [ads({ success: "to-critical-failure" })]), -1);
  assert(
    "an improvement and a worsening both apply (net 0)",
    adjust(1, [ads({ success: "one-degree-better" }), ads({ success: "one-degree-worse" })]),
    1,
  );
  assert(
    "the specific degree wins over all",
    adjust(0, [ads({ all: "one-degree-better", failure: "two-degrees-better" })]),
    2,
  );
  assert("no adjustments leaves the degree", adjust(0, []), 0);
  // Old metadata (from rolls made before this change) only has value
  assert(
    "older metadata without worse still works",
    ctx.applyDegreeOfSuccessAdjustment(1, { all: { value: "none" }, success: { value: "one-degree-better", modifierName: "X" }, failure: { value: "none" }, criticalFailure: { value: "none" } }).degree,
    2,
  );
}

// --- math -----------------------------------------------------------------------

section("evaluateMath");
{
  assert("max with two arguments", ctx.evaluateMath("max(1,floor(ceil(3/2)/2))"), 1);
  assert("min with two arguments", ctx.evaluateMath("min(4, 2+3)"), 4);
  assert("plain arithmetic unchanged", ctx.evaluateMath("2*3+1"), 7);
  assert("letters are still rejected", ctx.evaluateMath("alert(1)"), 0);
  assert("braces with min() in a replacement", ctx.checkForReplacements("{min(5,@actor.level)}", {}, pc({ level: 8 })), "5");
}

// --- IWR, AC and HP --------------------------------------------------------------

section("resistance with a number value");
{
  const record = pc({ feats: [feat("Plant Shape", [{ type: "resistance", modifierType: "none", field: "poison", active: true, valueType: "number", value: "5" }])] });
  const iwr = ctx.getIWR(record);
  assert("a number value takes its type from the field", iwr.resistances?.poison?.value, 5);
  const stringRecord = pc({ feats: [feat("Elemental", [{ type: "resistance", modifierType: "none", field: "", active: true, valueType: "string", value: "fire 5" }])] });
  assert("a string value still works", ctx.getIWR(stringRecord).resistances?.fire?.value, 5);
}

section("AC modifier values");
{
  const acWith = (mods) => {
    const record = pc({ feats: [feat("Hide", mods)] });
    const written = {};
    ctx.updateAttribute({ record, attribute: "dex", value: 3, moreValuesToSet: written });
    return written["data.ac"];
  };
  const base = acWith([]);
  assert("a numeric AC bonus adds", acWith([{ type: "armorClassBonus", modifierType: "item", field: "", active: true, valueType: "number", value: "2" }]), base + 2);
  assert("a string AC bonus adds instead of concatenating", acWith([{ type: "armorClassBonus", modifierType: "item", field: "", active: true, valueType: "string", value: "{3}" }]), base + 3);
  assert("an AC bonus whose predicate fails adds nothing", acWith([{ type: "armorClassBonus", modifierType: "circumstance", field: "", valueType: "number", value: "2", predicate: '["never-set"]' }]), base);
  assert(
    "a dexCap modifier caps Dex to AC",
    acWith([{ type: "dexCap", active: true, valueType: "number", value: "1" }]),
    base - 2,
  );
}

section("HP modifiers honor their predicate");
{
  const hpWith = (mods) => {
    const record = pc({ feats: [feat("Hardy", mods)] });
    const written = {};
    ctx.updateAttribute({ record, attribute: "con", value: 1, moreValuesToSet: written });
    return written["data.hitpoints"];
  };
  const base = hpWith([]);
  assert("an always-on HP modifier adds", hpWith([{ type: "hitpoints", valueType: "string", value: "@actor.level", active: true }]), base + 5);
  assert("a failed predicate adds nothing", hpWith([{ type: "hitpoints", valueType: "string", value: "@actor.level", predicate: '["self:condition:drained"]' }]), base);
  assert("an opted-out modifier adds nothing", hpWith([{ type: "hitpoints", valueType: "number", value: "5", active: false }]), base);
}

// --- damage categories and critical riders -------------------------------------

section("persistent and splash damage honor active");
{
  const processed = ctx.processDamageModifierCategories([
    { name: "On", value: "1d4 fire-persistent", active: true },
    { name: "Off", value: "1d6 bleed-persistent", active: false },
    { name: "Crit", value: "1d4 mental-persistent", active: true, criticalOnly: true },
    { name: "Splash Off", value: "1d4 acid-splash", active: false },
  ]);
  assert("only the active persistent damage applies", processed.persistentDamage, "1d4 fire");
  assert("critical-only persistent damage is kept apart", processed.criticalPersistentDamage, "1d4 mental");
  assert("inactive splash is not applied", processed.splashDamage, "");
}

section("critical-hit-only damage riders");
{
  assert("dice for 2d6 fire", JSON.stringify(ctx.getCriticalOnlyDiceForValue("2d6 fire", "slashing")), JSON.stringify([{ dieType: 6, damageType: "fire" }, { dieType: 6, damageType: "fire" }]));
  assert("untyped dice take the weapon's type", ctx.getCriticalOnlyDiceForValue("1d8", "Slashing")[0].damageType, "slashing");

  const claws = weapon("Claw", { itemCategory: "unarmed", group: "brawling", traits: ["agile", "finesse", "unarmed"], damage: { dice: 1, die: "d6", damageType: "slashing" } });
  const accursed = feat("Accursed Claws", [{ type: "damageBonus", modifierType: "none", field: "", valueType: "string", value: "1d4 mental-persistent", critical: true, predicate: '["item:slug:claw"]' }]);
  const brutal = feat("Brutal Critical", [{ type: "damageBonus", modifierType: "none", field: "", valueType: "string", value: "1d@weaponDie", predicate: '["check:outcome:critical-success"]' }]);
  const record = pc({ feats: [accursed, brutal], inventory: [claws] });
  const attack = capturePrompt(() => ctx.performAttackRoll(record, claws, "data.inventory.0", 1)).metadata;
  const riders = (attack.damageModifiers || []).filter((m) => m.criticalOnly);
  assert("the check:outcome rider is carried as critical-only", names(riders).join(","), "Brutal Critical");
  assert("and active (the attack handler drops it on a non-crit)", riders[0]?.active, true);
  assert("its die resolved from the weapon", riders[0]?.value, "1d6");
  assert("the critical persistent damage is in the metadata", attack.criticalPersistentDamage, "1d4 mental");
  assert("and not in the normal persistent damage", attack.persistentDamage || "", "");

  const normal = capturePrompt(() => ctx.performDamageRoll(record, claws, "data.inventory.0", false));
  assertNotIncludes("a normal damage roll has no critical rider", names(normal.modifiers), "Brutal Critical");
  assert("and no critical persistent damage", normal.metadata.criticalPersistentDamage, "");
  const crit = capturePrompt(() => ctx.performDamageRoll(record, claws, "data.inventory.0", true));
  assertIncludes("a critical damage roll adds the rider", names(crit.modifiers), "Brutal Critical");
  assert("and the critical persistent damage", crit.metadata.criticalPersistentDamage, "1d4 mental");
  assert("the rider's die is critical-only (not doubled)", crit.metadata.criticalOnlyDice.some((d) => d.dieType === 6), true);
}

// --- Foundry atoms ----------------------------------------------------------------

section("Foundry item atoms");
{
  const bow = weapon("+1 Striking Flaming Longbow", { group: "bow", range: 100, usage: "held-in-one-plus-hands", runes: { potency: 1, striking: 1, property: ["Flaming"] } });
  const traits = traitsFor(pc(), { weapon: bow });
  assertIncludes("item:base strips runes", traits, "item:base:longbow");
  assertIncludes("item:slug is the full name", traits, "item:slug:1-striking-flaming-longbow");
  assertIncludes("item:type:weapon", traits, "item:type:weapon");
  assertIncludes("item:hands-held from usage", traits, "item:hands-held:1");
  assertIncludes("item:magical with runes", traits, "item:magical");
  const greataxe = traitsFor(pc(), { weapon: weapon("Greataxe", { usage: "held-in-two-hands" }) });
  assertIncludes("two-handed usage", greataxe, "item:usage:hands:2");
  assert("getBaseItemSlug", ctx.getBaseItemSlug({ name: "+2 Greater Striking Shortsword", data: {} }), "shortsword");
}

section("skill rank and armor atoms");
{
  const record = pc({ athletics: "3", medicine: "1", loreSkills: [{ name: "Sailing Lore", data: { rank: "2" } }] });
  const traits = traitsFor(record, { statistic: "athletics" });
  assertIncludes("skill:athletics:rank:3", traits, "skill:athletics:rank:3");
  assertIncludes("lore skill ranks", traits, "skill:sailing-lore:rank:2");
  assertIncludes("the statistic rolled", traits, "check:statistic:athletics");
  assertIncludes("proficiency of the statistic", traits, "proficiency:master");
  const set = ctx.collectTraitsAndProperties(record, {});
  assert("gte skill rank resolves", ctx.evaluateEffectPredicate({ gte: ["skill:athletics:rank", 2] }, set, record, {}), true);
  assert("gte skill rank fails below", ctx.evaluateEffectPredicate({ gte: ["skill:medicine:rank", 2] }, set, record, {}), false);
  assertIncludes("unarmored", traits, "self:armor:category:unarmored");
  const armored = pc({ inventory: [{ _id: "a", name: "Chain Mail", data: { type: "armor", carried: "equipped", acBonus: 4, dexCap: 1, itemCategory: "Medium" } }] });
  const armoredTraits = traitsFor(armored);
  assertIncludes("self:armored in armor", armoredTraits, "self:armored");
  assertIncludes("armor category", armoredTraits, "self:armor:category:medium");
}

section("target atoms");
{
  const undead = { token: { _id: "t", recordType: "npcs", effects: [{ name: "Off-Guard" }], data: { level: 3, traits: ["Undead", "Zombie"] } }, distance: 5 };
  const traits = traitsFor(pc(), { weapon: weapon("Longsword"), targets: [undead] });
  assertIncludes("target trait", traits, "target:trait:undead");
  assertIncludes("target condition", traits, "target:condition:off-guard");
  assertIncludes("target level", traits, "target:level:3");
  assertIncludes("melee range increment 1", traits, "target:range-increment:1");
  const two = traitsFor(pc(), { weapon: weapon("Longsword"), targets: [undead, undead] });
  assertNotIncludes("with two targets no per-target trait", two, "target:trait:undead");
}

// --- selectors and situational opt-ins ------------------------------------------

section("Foundry selectors as fields");
{
  const record = pc({
    feats: [
      feat("Iron Will", [{ type: "saveBonus", modifierType: "circumstance", field: "saving-throw", active: true, valueType: "number", value: "1" }]),
      feat("Skilled", [{ type: "skillBonus", modifierType: "circumstance", field: "skill-check", active: true, valueType: "number", value: "1" }]),
    ],
  });
  assertIncludes("saving-throw applies to a Will save", names(capturePrompt(() => ctx.rollSave(record, "will")).modifiers), "Iron Will");
  assertIncludes("skill-check applies to Athletics", names(capturePrompt(() => ctx.rollSkill(record, "athletics")).modifiers), "Skilled");
  assertNotIncludes("skill-check does not apply to Perception", names(capturePrompt(() => ctx.rollSkill(record, "perception")).modifiers), "Skilled");

  const fist = weapon("Fist", { itemCategory: "unarmed", group: "brawling", traits: ["agile", "finesse", "nonlethal", "unarmed"], damage: { dice: 1, die: "d4", damageType: "bludgeoning" } });
  const brawler = pc({
    feats: [
      feat("Brawler", [{ type: "damageBonus", modifierType: "none", field: "unarmed", active: true, valueType: "number", value: "2" }]),
      feat("Aim", [{ type: "attackBonus", modifierType: "circumstance", field: "attack-roll", active: true, valueType: "number", value: "1" }]),
    ],
    inventory: [fist],
  });
  const attack = capturePrompt(() => ctx.performAttackRoll(brawler, fist, "data.inventory.0", 1));
  assertIncludes("damage field unarmed now applies to unarmed Strikes", names(attack.metadata.damageModifiers || []), "Brawler");
  assertIncludes("attack-roll applies to Strikes", names(attack.modifiers), "Aim");
}

section("situational modifiers become opt-ins");
{
  const glare = feat("Intimidating Glare", [{ type: "skillBonus", modifierType: "circumstance", field: "intimidation", valueType: "number", value: "1", predicate: '["action:demoralize"]' }]);
  const record = pc({ feats: [glare] });
  const plain = capturePrompt(() => ctx.rollSkill(record, "intimidation")).modifiers.find((m) => m.name.startsWith("Intimidating Glare"));
  assert("offered without an action, labelled with it", plain?.name, "Intimidating Glare (Demoralize)");
  assert("but not ticked", plain?.active, false);
  const withAction = capturePrompt(() => ctx.rollSkill(record, "intimidation", null, false, 0, 1, "int", false, false, undefined, { action: "Demoralize" })).modifiers.find((m) => m.name.startsWith("Intimidating Glare"));
  assert("with the action it applies", withAction?.active, true);
  const otherAction = capturePrompt(() => ctx.rollSkill(record, "intimidation", null, false, 0, 1, "int", false, false, undefined, { action: "Coerce" })).modifiers.find((m) => m.name.startsWith("Intimidating Glare"));
  assert("with a different action: unticked and not relabelled", `${otherAction?.name}|${otherAction?.active}`, "Intimidating Glare|false");

  const bravery = feat("Bravery", [{ type: "saveBonus", modifierType: "circumstance", field: "will", valueType: "number", value: "1", predicate: '["fear"]' }]);
  const brave = pc({ feats: [bravery] });
  const unknown = capturePrompt(() => ctx.rollSave(brave, "will")).modifiers.find((m) => m.name.startsWith("Bravery"));
  assert("a save with no source: opt-in vs fear", `${unknown?.name}|${unknown?.active}`, "Bravery (vs fear)|false");
  const fear = capturePrompt(() => ctx.rollSave(brave, "will", 20, true, false, { traits: ["Emotion", "Fear", "Mental"] })).modifiers.find((m) => m.name.startsWith("Bravery"));
  assert("a fear spell's save applies it", fear?.active, true);
  const fire = capturePrompt(() => ctx.rollSave(brave, "will", 20, true, false, { traits: ["Fire"] })).modifiers.find((m) => m.name.startsWith("Bravery"));
  assert("a non-fear source: unticked and not relabelled", `${fire?.name}|${fire?.active}`, "Bravery|false");
  // An older spell save button passes no traits: still offered as an opt-in
  const oldButton = capturePrompt(() => ctx.rollSave(brave, "will", 20, true, false)).modifiers.find((m) => m.name.startsWith("Bravery"));
  assert("an old spell save button keeps the opt-in", oldButton?.active, false);

  const slayer = feat("Undead Slayer", [{ type: "damageBonus", modifierType: "none", field: "", valueType: "string", value: "1d6 vitality", predicate: '["target:trait:undead"]' }]);
  const swordsman = pc({ feats: [slayer], inventory: [weapon("Longsword")] });
  const noTarget = capturePrompt(() => ctx.performAttackRoll(swordsman, swordsman.data.inventory[0], "data.inventory.0", 1)).metadata.damageModifiers || [];
  assert("no target: opt-in vs undead", noTarget.find((m) => m.name.startsWith("Undead Slayer"))?.name, "Undead Slayer (vs undead)");
  const realTargets = ctx.api.getTargets;
  ctx.api.getTargets = () => [{ token: { _id: "z", recordType: "npcs", effects: [], data: { ac: 15, level: 1, traits: ["Undead"] } }, distance: 5 }];
  const undeadTarget = capturePrompt(() => ctx.performAttackRoll(swordsman, swordsman.data.inventory[0], "data.inventory.0", 1)).metadata.damageModifiers || [];
  assert("an undead target applies it", undeadTarget.find((m) => m.name === "Undead Slayer")?.active, true);
  ctx.api.getTargets = () => [{ token: { _id: "g", recordType: "npcs", effects: [], data: { ac: 15, level: 1, traits: ["Humanoid"] } }, distance: 5 }];
  const livingTarget = capturePrompt(() => ctx.performAttackRoll(swordsman, swordsman.data.inventory[0], "data.inventory.0", 1)).metadata.damageModifiers || [];
  const living = livingTarget.find((m) => m.name.startsWith("Undead Slayer"));
  assert("a living target: unticked and not relabelled", `${living?.name}|${living?.active}`, "Undead Slayer|false");
  ctx.api.getTargets = realTargets;

  // Sheet values (HP, AC) don't become opt-ins
  const hp = lookup(pc({ feats: [feat("X", [{ type: "hitpoints", valueType: "number", value: "5", predicate: '["action:rest"]' }])] }), ["hitpoints"]);
  assert("HP modifiers are not relabelled", hp[0]?.situational, undefined);
}

// --- weapon alterations and tokens ---------------------------------------------

section("weapon die size and trait modifiers");
{
  const jaws = weapon("Jaws", { itemCategory: "unarmed", group: "brawling", traits: ["unarmed"], damage: { dice: 1, die: "d4", damageType: "piercing" } });
  const fist = weapon("Fist", { itemCategory: "unarmed", group: "brawling", traits: ["agile", "unarmed"], damage: { dice: 1, die: "d4", damageType: "bludgeoning" } });
  const incisors = feat("Vicious Incisors", [
    { type: "weaponDieSize", value: "d6", predicate: '["item:slug:jaws"]' },
    { type: "weaponTrait", value: "backstabber", predicate: '["item:slug:jaws"]' },
  ]);
  const record = pc({ feats: [incisors], inventory: [jaws, fist] });
  const alteredJaws = ctx.getAlteredWeapon(record, jaws);
  assert("Jaws die becomes d6", alteredJaws.data.damage.die, "d6");
  assertIncludes("Jaws gains backstabber", alteredJaws.data.traits, "backstabber");
  assert("the stored weapon is untouched", jaws.data.damage.die, "d4");
  assert("Fist is unchanged", ctx.getAlteredWeapon(record, fist).data.damage.die, "d4");
  const damage = capturePrompt(() => ctx.performDamageRoll(record, jaws, "data.inventory.0", false)).dice;
  assert("the damage roll uses d6", /1d6/.test(damage), true);

  const stepper = pc({ feats: [feat("Crunch", [{ type: "weaponDieSize", value: "upgrade", predicate: '["item:slug:jaws"]' }])] });
  assert("upgrade steps d4 -> d6", ctx.getAlteredWeapon(stepper, jaws).data.damage.die, "d6");
  const remover = pc({ feats: [feat("Lethal", [{ type: "weaponTrait", value: "-agile" }])] });
  assertNotIncludes("a trait can be removed", ctx.getAlteredWeapon(remover, fist).data.traits, "agile");
}

section("weapon dice tokens");
{
  const sword = weapon("Longsword", { runes: { potency: 1, striking: 2, property: [] } });
  const record = pc();
  assert("@weaponDiceCount counts striking runes", ctx.checkForReplacements("@weaponDiceCount", {}, record, null, { weapon: sword }), "3");
  assert("@weapon.system.damage.dice", ctx.checkForReplacements("@weapon.system.damage.dice", {}, record, null, { weapon: sword }), "3");
  assert("1@weaponDie means one die", ctx.checkForReplacements("1@weaponDie", {}, record, null, { weapon: sword }), "1d8");
  assert("1d@weaponDie unchanged", ctx.checkForReplacements("1d@weaponDie", {}, record, null, { weapon: sword }), "1d8");
  assert(
    "ternary(...)@weaponDie means that many dice",
    ctx.checkForReplacements("ternary(gte(@actor.level,4),2,1)@weaponDie", {}, record, null, { weapon: sword }),
    "2d8",
  );
}

// --- speeds, senses, dying --------------------------------------------------------

section("other movement Speeds");
{
  const speedWith = (mods) => {
    const record = pc({ feats: [feat("Mover", mods)] });
    const written = {};
    ctx.updateAttribute({ record, attribute: "str", value: 2, moreValuesToSet: written });
    return written["data.speed"] ?? record.data.speed;
  };
  assert("a climb Speed is listed", speedWith([{ type: "speed", field: "climb", value: "20" }]), "25 feet, climb 20 feet");
  assert("equal to land Speed", speedWith([{ type: "speed", field: "swim", value: "land" }]), "25 feet, swim 25 feet");
  assert(
    "a speedBonus with a fly field does not raise land Speed",
    speedWith([{ type: "speedBonus", modifierType: "status", field: "fly", active: true, valueType: "number", value: "10" }]),
    "25 feet",
  );
  assert(
    "a speedBonus with no field still raises land Speed",
    speedWith([{ type: "speedBonus", modifierType: "status", field: "", active: true, valueType: "number", value: "5" }]),
    "30 feet",
  );
  assert(
    "a speedBonus adds to a granted climb Speed",
    speedWith([{ type: "speed", field: "climb", value: "20" }, { type: "speedBonus", modifierType: "circumstance", field: "climb", active: true, valueType: "number", value: "5" }]),
    "25 feet, climb 25 feet",
  );
  assert("a failed predicate grants no Speed", speedWith([{ type: "speed", field: "fly", value: "20", predicate: '["self:effect:wings"]' }]), "25 feet");
}

section("senses follow their predicate");
{
  const sensesFor = (record) => {
    const saved = ctx.api.setValuesOnRecord;
    let written = {};
    ctx.api.setValuesOnRecord = (rec, values) => Object.assign(written, values);
    try {
      ctx.onAddEditFeature(record, undefined, true);
    } finally {
      ctx.api.setValuesOnRecord = saved;
    }
    return written;
  };
  const vision = (predicate) => feat("Acute Vision", [{ type: "sense", value: "Darkvision", ...(predicate ? { predicate } : {}) }]);
  const always = sensesFor(pc({ senses: "Low-Light Vision", feats: [vision()] }));
  assert("an always-on sense is added (Darkvision replaces Low-Light)", always["data.senses"], "Darkvision");
  const raging = sensesFor(pc({ senses: "", feats: [vision('["self:effect:rage"]')] }));
  assert("a sense whose predicate fails is not added", raging["data.senses"] ?? "", "");
  // Removing the feat later takes the sense away again
  const computed = pc({ senses: "Darkvision", baseSenses: "", computedSenses: "Darkvision", feats: [] });
  assert("a computed sense goes away with its feat", sensesFor(computed)["data.senses"], "");
  const handEdited = pc({ senses: "Scent (imprecise) 30 feet", baseSenses: "", computedSenses: "Darkvision", feats: [] });
  assert("a hand-edited senses value is kept", sensesFor(handEdited)["data.senses"] ?? handEdited.data.senses, "Scent (imprecise) 30 feet");
}

section("dying maximum and recovery DC modifiers");
{
  const creature = (feats) => ({ ...pc({ feats }), data: { ...pc({ feats }).data, dying: 2 } });
  assert("default death threshold 4", ctx.getDeathThreshold(creature([])), 4);
  assert("Diehard by name still works", ctx.getDeathThreshold(creature([feat("Diehard", [])])), 5);
  assert("a dyingMax modifier raises it", ctx.getDeathThreshold(creature([feat("Undying", [{ type: "dyingMax", value: "5" }])])), 5);
  assert("recovery DC 10 + dying", ctx.getRecoveryCheckDC(creature([])), 12);
  assert("Toughness by name still works", ctx.getRecoveryCheckDC(creature([feat("Toughness", [])])), 11);
  assert("a recoveryDC modifier lowers it", ctx.getRecoveryCheckDC(creature([feat("Mountain's Stoutness", [{ type: "recoveryDC", value: "-1" }])])), 11);
  assert("the strongest reduction applies, not both", ctx.getRecoveryCheckDC(creature([feat("Toughness", []), feat("Mountain's Stoutness", [{ type: "recoveryDC", value: "-1" }])])), 11);
}

// --- save macros ------------------------------------------------------------------

section("save macros carry the source's traits");
{
  const oldStyle = ctx.getSaveMacro("will", 20, true, true);
  assert("without traits the macro is unchanged", /rollSave\(token, 'will', 20, true, true\);/.test(oldStyle), true);
  const withTraits = ctx.getSaveMacro("will", 20, true, true, ["Common", "Emotion", "Fear"]);
  assert("with traits they are passed (rarity dropped)", withTraits.includes('rollSave(token, \'will\', 20, true, true, {"traits":["Emotion","Fear"]});'), true);
  // The generated macro code runs
  let rolled = null;
  const savedRollSave = ctx.rollSave;
  ctx.rollSave = (...args) => {
    rolled = args;
  };
  ctx.api.getSelectedOrDroppedToken = () => [{ _id: "x" }];
  const code = withTraits.split("\n").slice(1, -1).join("\n");
  new vm.Script(code).runInContext(ctx);
  ctx.rollSave = savedRollSave;
  ctx.api.getSelectedOrDroppedToken = () => [];
  assert("the macro passes the traits to rollSave", JSON.stringify(rolled?.[5]), JSON.stringify({ traits: ["Emotion", "Fear"] }));
}

section("smaller engine fixes");
{
  // Foundry's ability/proficiency modifier types stack instead of vanishing
  const kept = ctx.keepStrongestPerType([
    { name: "A", type: "proficiency", value: 3 },
    { name: "B", type: "proficiency", value: 5 },
    { name: "C", type: "ability", value: 2 },
  ]);
  assert("proficiency and ability types keep the strongest", kept.map((m) => m.name).sort().join(","), "B,C");

  // A critical specialization predicate written as an object now evaluates
  const sword = weapon("Longsword");
  const critSpec = (predicate) => ctx.hasCriticalSpecializationEffect(pc({ feats: [feat("Spec", [{ type: "criticalSpecialization", predicate }])] }), sword, false);
  assert("object predicate that matches", critSpec('{"or":["item:group:sword","item:group:axe"]}'), true);
  assert("object predicate that does not match", critSpec('{"or":["item:group:bow","item:group:axe"]}'), false);

  // Toggles on bonus feats are listed
  const toggleFeat = { ...feat("Rage Toggle", []), data: { type: "class", level: 1, toggleable: true, predicateValue: "rage-toggle" } };
  const written = {};
  ctx.updateTogglesList({ ...pc(), data: { ...pc().data, bonusFeats: [toggleFeat] } }, written);
  assert("a bonus feat's toggle is listed", (written["data.toggles"] || []).some((t) => t.data?.predicateValue === "rage-toggle"), true);

  // MAP reduction "1/2": second attack -1, third -2
  const agile = weapon("Shortsword", { traits: ["agile", "finesse"] });
  const grace = pc({ feats: [feat("Agile Grace", [{ type: "mapReduction", field: "attack", active: true, valueType: "string", value: "1/2", predicate: '["item:trait:agile"]' }])], inventory: [agile] });
  const reduce = (n) => capturePrompt(() => ctx.performAttackRoll(grace, agile, "data.inventory.0", n)).modifiers.find((m) => m.name.includes("Reduce MAP"))?.value;
  assert("second attack reduced by 1", reduce(2), 1);
  assert("third attack reduced by 2", reduce(3), 2);
}

summary();
