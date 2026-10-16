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
  // Foundry's ability/proficiency types stay dropped: imported values of
  // those types (e.g. "@actor.level + clamp(...)") would break rolls
  const kept = ctx.keepStrongestPerType([
    { name: "A", type: "proficiency", value: 3 },
    { name: "C", type: "ability", value: 2 },
    { name: "D", type: "", value: 1 },
  ]);
  assert("proficiency and ability types are left out", kept.map((m) => m.name).join(","), "D");

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

section("off-guard targets: backstabber and off-guard predicates");
{
  const dagger = weapon("Dagger", { traits: ["agile", "finesse", "backstabber"], group: "knife", damage: { dice: 1, die: "d4", damageType: "piercing" } });
  const ambush = feat("Ambush", [{ type: "damageBonus", modifierType: "circumstance", field: "", valueType: "number", value: "2", predicate: '["target:condition:off-guard"]' }]);
  const rogue = pc({ feats: [ambush], inventory: [dagger] });
  const realTargets = ctx.api.getTargets;
  const realOther = ctx.api.getOtherTokens;
  ctx.api.getTargets = () => [{ token: { _id: "t", recordType: "npcs", effects: [{ name: "Off-Guard", rules: [] }], data: { ac: 15, level: 1, traits: [] } }, distance: 5 }];
  ctx.api.getOtherTokens = () => [];
  const mods = capturePrompt(() => ctx.performAttackRoll(rogue, dagger, "data.inventory.0", 1)).metadata.damageModifiers || [];
  const backstab = mods.find((m) => m.name === "Backstabber");
  assert("backstabber adds 1 precision vs an off-guard target", `${backstab?.value}|${backstab?.precisionDamage}`, "1|true");
  assert("an off-guard predicate applies", mods.find((m) => m.name.startsWith("Ambush"))?.active, true);
  ctx.api.getTargets = () => [{ token: { _id: "t", recordType: "npcs", effects: [], data: { ac: 15, level: 1, traits: [] } }, distance: 5 }];
  const calm = capturePrompt(() => ctx.performAttackRoll(rogue, dagger, "data.inventory.0", 1)).metadata.damageModifiers || [];
  assert("no backstabber vs a target that isn't off-guard", calm.some((m) => m.name === "Backstabber"), false);
  ctx.api.getTargets = realTargets;
  ctx.api.getOtherTokens = realOther;
}

section("Treat Wounds and First Aid pass their action");
{
  const surgeon = pc({
    medicine: "2",
    feats: [
      feat("Risky Surgery", [{ type: "adjustDegreeOfSuccess", field: "medicine", adjustment: { success: "one-degree-better" }, predicate: '["action:treat-wounds"]' }]),
      feat("Steady Hands", [{ type: "skillBonus", modifierType: "circumstance", field: "medicine", valueType: "number", value: "1", predicate: '["action:administer-first-aid"]' }]),
    ],
  });
  const firstAid = ctx.getMedicineCheckModifiers(surgeon).modifiers.find((m) => m.name.startsWith("Steady Hands"));
  assert("a First Aid bonus applies on First Aid", firstAid?.active, true);
  const context = ctx.getRollSourceContext({ action: "Treat Wounds" }, "medicine");
  const adjustments = ctx.getDegreeOfSuccessAdjustments(surgeon, ["medicine", "skill-check", "wis"], undefined, undefined, context);
  assert("a Treat Wounds degree adjustment applies with the action", adjustments.success.value, "one-degree-better");
}

section("lore ranks and resolved labels");
{
  const sailor = pc({ loreSkills: [{ name: "Sailing Lore", data: { rank: "2" } }] });
  const traits = traitsFor(sailor, { statistic: "Sailing Lore" });
  assertIncludes("a Lore roll's proficiency comes from its entry", traits, "proficiency:expert");
  const guide = pc({
    flags: { terrain: "Aquatic" },
    feats: [feat("Terrain Expertise", [{ type: "skillBonus", modifierType: "circumstance", field: "survival", valueType: "number", value: "1", predicate: '["terrain:@record.data.flags.terrain"]' }])],
  });
  const realGet = ctx.api.getValueOnRecord;
  ctx.api.getValueOnRecord = (rec, path) => path.split(".").reduce((o, k) => o?.[k], rec);
  const mod = capturePrompt(() => ctx.rollSkill(guide, "survival")).modifiers.find((m) => m.name.startsWith("Terrain Expertise"));
  ctx.api.getValueOnRecord = realGet;
  assert("the label shows the chosen terrain", mod?.name, "Terrain Expertise (aquatic terrain)");
}

section("engine gaps closed: backstabber slug, half Speed, condition values, range, off-guard, runes");
{
  const realTargets = ctx.api.getTargets;
  const realOther = ctx.api.getOtherTokens;
  ctx.api.getOtherTokens = () => [];
  const frightened2 = { _id: "f", name: "Frightened", rules: [] };
  const scaredTarget = { token: { _id: "t", recordType: "npcs", effects: [frightened2], effectIds: ["f", "f"], data: { ac: 15, level: 1, traits: ["Incorporeal"] } }, distance: 5 };

  // Expert Backstabber: adjustModifier on the backstabber slug
  const dagger = weapon("Dagger", { traits: ["agile", "finesse", "backstabber"], group: "knife", damage: { dice: 1, die: "d4", damageType: "piercing" } });
  const expert = pc({ feats: [feat("Expert Backstabber", [{ type: "adjustModifier", targetSlug: "backstabber", adjustMode: "override", value: "2", valueType: "number", active: true, field: "" }])], inventory: [dagger] });
  ctx.api.getTargets = () => [{ token: { _id: "t", recordType: "npcs", effects: [{ _id: "og", name: "Off-Guard", rules: [] }], effectIds: ["og"], data: { ac: 15, level: 1, traits: [] } }, distance: 5 }];
  const stab = (capturePrompt(() => ctx.performAttackRoll(expert, dagger, "data.inventory.0", 1)).metadata.damageModifiers || []).find((m) => m.name === "Backstabber");
  assert("Expert Backstabber raises backstabber to 2", stab?.value, "2");

  // Fearsome Brute: double the target's frightened value
  ctx.api.getTargets = () => [scaredTarget];
  const brute = pc({ feats: [feat("Fearsome Brute", [{ type: "damageBonus", modifierType: "circumstance", field: "strike-damage", valueType: "string", value: "{2*@target.condition.frightened}", predicate: '["target:condition:frightened"]' }])], inventory: [weapon("Longsword")] });
  const fb = (capturePrompt(() => ctx.performAttackRoll(brute, brute.data.inventory[0], "data.inventory.0", 1)).metadata.damageModifiers || []).find((m) => m.name === "Fearsome Brute");
  assert("Fearsome Brute: 2 x frightened 2 = 4", `${fb?.value}|${fb?.active}`, "4|true");
  assertIncludes("frightened value atom", traitsFor(brute, { targets: [scaredTarget] }), "target:condition:frightened:2");

  // Dread Striker: a frightened target is off-guard to you (AC -2)
  const striker = pc({ feats: [feat("Dread Striker", [{ type: "offGuardTarget", active: true, predicate: '["target:condition:frightened"]' }])], inventory: [weapon("Longsword")] });
  const dread = capturePrompt(() => ctx.performAttackRoll(striker, striker.data.inventory[0], "data.inventory.0", 1)).metadata;
  const plain = capturePrompt(() => ctx.performAttackRoll(pc({ inventory: [weapon("Longsword")] }), weapon("Longsword"), "data.inventory.0", 1)).metadata;
  assert("Dread Striker: the target is off-guard", dread.isOffGuard, true);
  assert("and its AC is 2 lower", plain.dc - dread.dc, 2);

  // Ghost Hunter: ghost touch vs an incorporeal target
  const hunter = pc({ feats: [feat("Ghost Hunter", [{ type: "weaponRune", value: "Ghost Touch", predicate: '["target:trait:incorporeal","item:magical"]' }])] });
  const magicSword = weapon("+1 Longsword", { runes: { potency: 1, striking: 0, property: [] } });
  assertIncludes("Ghost Hunter adds ghost touch vs incorporeal", ctx.getAlteredWeapon(hunter, magicSword).data.runes.property, "Ghost Touch");
  ctx.api.getTargets = () => [];
  assertNotIncludes("not without that target", ctx.getAlteredWeapon(hunter, magicSword).data.runes.property, "Ghost Touch");

  // Far Shot / Far Lobber: range increments
  const bow = weapon("Longbow", { range: 100, group: "bow" });
  const farShot = pc({ feats: [feat("Far Shot", [{ type: "weaponRange", value: "x2" }])] });
  assert("Far Shot doubles the range increment", ctx.getAlteredWeapon(farShot, bow).data.range, 200);
  const bomb = weapon("Alchemist's Fire", { range: 20, traits: ["bomb", "alchemical"] });
  const lobber = pc({ feats: [feat("Far Lobber", [{ type: "weaponRange", value: "30", predicate: '["item:trait:bomb"]' }])] });
  assert("Far Lobber sets bombs to 30", ctx.getAlteredWeapon(lobber, bomb).data.range, 30);
  assert("melee weapons keep range 0", ctx.getAlteredWeapon(farShot, weapon("Longsword")).data.range, 0);

  // Far Throw: -1 per extra increment with thrown weapons
  const javelin = weapon("Javelin", { range: 30, traits: ["Thrown"], group: "dart", reload: "-", ammo: 5 });
  const thrower = pc({ feats: [feat("Far Throw", [{ type: "rangeIncrementPenalty", value: "1", active: true, predicate: '["item:trait:thrown"]' }])], inventory: [javelin] });
  ctx.api.getTargets = () => [{ token: { _id: "t", recordType: "npcs", effects: [], data: { ac: 15, level: 1, traits: [] } }, distance: 90 }];
  const rangeMod = capturePrompt(() => ctx.performAttackRoll(thrower, javelin, "data.inventory.0", 1)).modifiers.find((m) => m.name.startsWith("Range Increment"));
  assert("Far Throw: third increment is -2, not -4", rangeMod?.value, -2);

  // Flamboyant Athlete: climb and swim equal to half land Speed
  const athlete = pc({ speed: "30 feet", ancestries: [{ name: "Elf", data: { speed: "30 feet", hp: 6 } }], feats: [feat("Flamboyant Athlete", [{ type: "speed", field: "climb", value: "half" }, { type: "speed", field: "swim", value: "half" }])] });
  const written = {};
  ctx.updateAttribute({ record: athlete, attribute: "str", value: 2, moreValuesToSet: written });
  assert("half land Speed (30 -> 15)", written["data.speed"], "30 feet, climb 15 feet, swim 15 feet");

  ctx.api.getTargets = realTargets;
  ctx.api.getOtherTokens = realOther;
}

section("imported Foundry data for the closed gaps works as-is");
{
  const realTargets = ctx.api.getTargets;
  const realOther = ctx.api.getOtherTokens;
  ctx.api.getOtherTokens = () => [];
  // Expert Backstabber as imported: adjustModifier multiply 2 on backstabber
  const dagger = weapon("+3 Dagger", { traits: ["agile", "finesse", "backstabber"], group: "knife", damage: { dice: 1, die: "d4", damageType: "piercing" }, runes: { potency: 3, striking: 0, property: [] } });
  const expert = pc({ feats: [feat("Expert Backstabber", [{ type: "adjustModifier", targetSlug: "backstabber", value: "2", valueType: "number", adjustMode: "multiply", active: true, field: "" }])], inventory: [dagger] });
  ctx.api.getTargets = () => [{ token: { _id: "t", recordType: "npcs", effects: [{ _id: "og", name: "Off-Guard", rules: [] }], effectIds: ["og"], data: { ac: 15, level: 1, traits: [] } }, distance: 5 }];
  const stab = (capturePrompt(() => ctx.performAttackRoll(expert, dagger, "data.inventory.0", 1)).metadata.damageModifiers || []).find((m) => m.name === "Backstabber");
  assert("imported Expert Backstabber: 4 with a +3 weapon", stab?.value, "4");
  // Far Throw as imported: adjustModifier add 1 on range-penalty
  const javelin = weapon("Javelin", { range: 30, traits: ["Thrown"], group: "dart", reload: "-", ammo: 5 });
  const thrower = pc({ feats: [feat("Far Throw", [{ type: "adjustModifier", targetSlug: "range-penalty", value: "1", valueType: "number", adjustMode: "add", active: true, field: "", predicate: '["item:trait:thrown"]' }])], inventory: [javelin] });
  ctx.api.getTargets = () => [{ token: { _id: "t", recordType: "npcs", effects: [], data: { ac: 15, level: 1, traits: [] } }, distance: 90 }];
  const rangeMod = capturePrompt(() => ctx.performAttackRoll(thrower, javelin, "data.inventory.0", 1)).modifiers.find((m) => m.name.startsWith("Range Increment"));
  assert("imported Far Throw: third increment is -2", rangeMod?.value, -2);
  // Fearsome Brute's Foundry token
  const scared = { token: { _id: "t", recordType: "npcs", effects: [{ _id: "f", name: "Frightened", rules: [] }], effectIds: ["f", "f", "f"], data: { ac: 15, level: 1, traits: [] } }, distance: 5 };
  assert("@target.conditions.frightened.badge.value", ctx.checkForReplacements("{2*@target.conditions.frightened.badge.value}", {}, pc(), null, { targets: [scared] }), "6");
  ctx.api.getTargets = realTargets;
  ctx.api.getOtherTokens = realOther;
}

section("roll twice: fortune and misfortune");
{
  const lucky = pc({ feats: [feat("Incredible Luck", [{ type: "rollTwice", field: "saving-throw", value: "keep-higher", active: true }])] });
  const save = capturePrompt(() => ctx.rollSave(lucky, "will")).modifiers.find((m) => m.name.startsWith("Incredible Luck"));
  assert("a fortune save offers advantage, ticked", `${save?.value}|${save?.active}`, "advantage|true");
  const cursed = pc({ feats: [feat("Hexed", [{ type: "rollTwice", field: "", value: "keep-lower", active: true }])], inventory: [weapon("Longsword")] });
  const strike = capturePrompt(() => ctx.performAttackRoll(cursed, cursed.data.inventory[0], "data.inventory.0", 1)).modifiers.find((m) => m.name.startsWith("Hexed"));
  assert("misfortune on a Strike", strike?.value, "disadvantage");
  const daring = pc({ feats: [feat("Derring-Do", [{ type: "rollTwice", field: "acrobatics", value: "keep-higher", predicate: '["action:tumble-through"]' }])] });
  const opt = capturePrompt(() => ctx.rollSkill(daring, "acrobatics")).modifiers.find((m) => m.name.startsWith("Derring-Do"));
  assert("a situational fortune is offered unticked", `${opt?.name}|${opt?.active}`, "Derring-Do (Tumble Through) (Fortune)|false");
}

section("skill actions: roll as an action");
{
  const realTargets = ctx.api.getTargets;
  const glare = feat("Intimidating Glare", [{ type: "skillBonus", modifierType: "circumstance", field: "intimidation", valueType: "number", value: "1", predicate: '["action:demoralize"]' }]);
  const record = pc({ intimidation: "2", feats: [glare] });
  ctx.api.getTargets = () => [{ token: { _id: "t", recordType: "npcs", effects: [], data: { level: 2, willMod: 6, traits: [] } } }];
  const rolled = capturePrompt(() => ctx.performSkillAction(record, "intimidation", "Demoralize"));
  assert("the bonus applies when rolled as Demoralize", rolled.modifiers.find((m) => m.name === "Intimidating Glare")?.active, true);
  assert("rolled against the target's Will DC", rolled.metadata.dc, 16);
  assert("the roll is named after the action", rolled.metadata.rollName, "Intimidation: Demoralize");
  const trip = capturePrompt(() => ctx.performSkillAction(pc(), "athletics", "Trip"));
  assert("an attack-trait action offers MAP opt-ins", trip.modifiers.filter((m) => m.name.startsWith("Multiple Attack Penalty") && m.active === false).length, 2);
  ctx.api.getTargets = () => [];
  assert("no target: no DC", capturePrompt(() => ctx.performSkillAction(record, "intimidation", "Demoralize")).metadata.dc, undefined);
  ctx.api.getTargets = realTargets;
  assert("an action card gets a roll button", ctx.getSkillActionMacros({ name: "Demoralize" }).includes('performSkillActionForSelected("intimidation", "Demoralize")'), true);
  assert("Recall Knowledge lists every knowledge skill", ctx.getSkillsForAction("Recall Knowledge").length, 7);
  assert("non-skill actions get no button", ctx.getSkillActionMacros({ name: "Stride" }), "");
}

section("defense DCs and healing received");
{
  const stance = feat("Disarming Stance", [{ type: "saveDCBonus", modifierType: "circumstance", field: "reflex", valueType: "number", value: "2", predicate: '["action:disarm"]' }]);
  const defender = pc({ reflexMod: 9, feats: [stance] });
  assert("Reflex DC 19 normally", ctx.getDefenseDCForToken(defender, "reflex", {}), 19);
  assert("Reflex DC 21 against Disarm", ctx.getDefenseDCForToken(defender, "reflex", { action: { name: "Disarm" } }), 21);
  const detector = pc({ perceptionMod: 8, feats: [feat("Lie Detector", [{ type: "saveDCBonus", modifierType: "circumstance", field: "perception", valueType: "number", value: "1", predicate: '["action:lie"]' }])] });
  assert("Perception DC 18", ctx.getDefenseDCForToken(detector, "perception", {}), 18);
  assert("Perception DC 19 against Lie", ctx.getDefenseDCForToken(detector, "perception", { action: { name: "Lie" } }), 19);

  const robust = pc({ curhp: 10, hitpoints: 100, feats: [feat("Robust Health", [{ type: "healingReceivedBonus", modifierType: "none", field: "", valueType: "string", value: "@actor.level", predicate: '["action:treat-wounds"]' }])] });
  ctx.__state.lastSet = null;
  ctx.applyHealingToToken(robust, 8, { treatWounds: true });
  assert("Treat Wounds heals 8 + level 5", ctx.__state.lastSet?.["data.curhp"], 23);
  ctx.__state.lastSet = null;
  ctx.applyHealingToToken(robust, 8, {});
  assert("other healing is unchanged", ctx.__state.lastSet?.["data.curhp"], 18);
}

section("more than one toggle per feat");
{
  const punch = { ...feat("One-Inch Punch", []), data: { type: "class", level: 1, toggleable: true, predicateValue: "one-inch-punch", toggleOptions: [
    { name: "Two Actions", data: { predicateValue: "one-inch-punch:two", group: "actions" } },
    { name: "Three Actions", data: { predicateValue: "one-inch-punch:three", group: "actions" } },
  ] } };
  const written = {};
  ctx.updateTogglesList(pc({ feats: [punch] }), written);
  const toggles = written["data.toggles"] || [];
  assert("the main toggle and both options are listed", toggles.map((t) => t.name).join(" | "), "One-Inch Punch | One-Inch Punch: Two Actions | One-Inch Punch: Three Actions");
  assert("options carry their group", toggles[1]?.data?.group, "One-Inch Punch|actions");
  const on = pc({ feats: [punch], toggles: [{ name: "One-Inch Punch: Three Actions", data: { predicateValue: "one-inch-punch:three", toggled: true } }] });
  assertIncludes("a toggled option is a predicate atom", traitsFor(on), "one-inch-punch:three");

  // The sheet's toggle checkbox turns off the rest of its group, then recalculates
  const listCtx = createSandbox();
  const html = fs.readFileSync(`${__dirname}/../toggle-list.html`, "utf8");
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(listCtx);
  let set = null;
  let recalculated = false;
  listCtx.dataPath = "data.toggles.1.data.toggled";
  listCtx.getNearestParentDataPath = () => "data.toggles.1";
  listCtx.record = { _id: "pc", recordType: "characters", data: { toggles: [
    { _id: "a", name: "A", data: { group: "g", toggled: true } },
    { _id: "b", name: "B", data: { group: "g", toggled: false } },
    { _id: "c", name: "C", data: { group: "", toggled: true } },
  ] } };
  listCtx.api.getValue = () => listCtx.record.data.toggles[1];
  listCtx.api.setValues = (values, cb) => { set = values; if (cb) cb(); };
  listCtx.api.getRecord = (type, id, cb) => cb(listCtx.record);
  listCtx.onAddEditFeature = () => { recalculated = true; };
  listCtx.onToggleChanged(true);
  assert("turning B on turns A off, leaves C", JSON.stringify(set), JSON.stringify({ "data.toggles.1.data.toggled": true, "data.toggles.0.data.toggled": false }));
  assert("and the sheet recalculates", recalculated, true);
}

section("bulk limit, check penalty, spell dice, damage on a miss");
{
  const hauler = pc({ str: 3, feats: [feat("Hefty Hauler", [{ type: "bulkLimit", value: "2", active: true }])] });
  const written = {};
  ctx.updateAttribute({ record: hauler, attribute: "str", value: 3, moreValuesToSet: written });
  assert("Hefty Hauler: 5 + 3 + 2", written["data.bulk"], 10);

  const plate = { _id: "a", name: "Full Plate", data: { type: "armor", carried: "equipped", acBonus: 6, checkPenalty: -3, strength: 4, itemCategory: "Heavy" } };
  const sneaky = pc({ str: 1, inventory: [plate], feats: [feat("Armored Stealth", [{ type: "adjustModifier", targetSlug: "armor-check-penalty", adjustMode: "add", value: "1", valueType: "number", active: true, field: "", predicate: '["check:statistic:stealth"]' }])] });
  const penalty = (skill) => capturePrompt(() => ctx.rollSkill(sneaky, skill)).modifiers.find((m) => m.name === "Check Penalty")?.value;
  assert("Armored Stealth: Stealth check penalty -2", penalty("stealth"), -2);
  assert("other skills keep -3", penalty("athletics"), -3);

  const heal = { _id: "s", name: "Heal", recordType: "spells", data: { level: 1, traits: ["Healing", "Vitality"], damage: [] } };
  const healer = pc({ feats: [feat("Healing Hands", [{ type: "spellDieSize", value: "d10", predicate: '["item:slug:heal"]' }])] });
  assert("Healing Hands: heal rolls d10s", ctx.applySpellDieSize(healer, heal, "2d8", "healing"), "2d10");
  assert("other spells keep their dice", ctx.applySpellDieSize(healer, { ...heal, name: "Harm" }, "2d8", "damage"), "2d8");

  const sword = weapon("Longsword");
  const finisher = pc({ feats: [feat("Brutal Finish", [{ type: "damageBonus", modifierType: "none", field: "", valueType: "string", value: "1d@weaponDie", failureOnly: true }])], inventory: [sword] });
  const meta = capturePrompt(() => ctx.performAttackRoll(finisher, sword, "data.inventory.0", 1)).metadata;
  assert("miss damage is carried for the miss button", meta.failureDamage, "1d8 slashing");
  assert("and kept out of the normal damage", (meta.damageModifiers || []).some((m) => m.name === "Brutal Finish"), false);
  const outcomePredicate = pc({ feats: [feat("Glancing", [{ type: "damageBonus", modifierType: "none", field: "", valueType: "string", value: "2", predicate: '["check:outcome:failure"]' }])], inventory: [sword] });
  assert("a check:outcome:failure predicate works too", capturePrompt(() => ctx.performAttackRoll(outcomePredicate, sword, "data.inventory.0", 1)).metadata.failureDamage, "2 slashing");
}

process.exitCode = summary();
