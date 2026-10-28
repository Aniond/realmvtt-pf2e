// Tests for PF2e Immunities / Weaknesses / Resistances (IWR) damage application
// Exercises rollhandlers/common.js applyDamage() end-to-end, including where
// the damage comes from (definitions, exceptions), physical IWR, partial
// resistance ignore, spell damage, void healing, harmedBy and suppressIWR.
// Run: node tests/test-iwr.js   (or via tests/run-all.js)

const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

// --- helpers --------------------------------------------------------------

const START_HP = 1000; // large so HP never hits 0 (avoids dying/death branches)

// Build an NPC target with the given IWR data. recordType "npcs" skips the
// character-only armor path in applyDamage.
function makeTarget(data) {
  return {
    _id: "target",
    recordType: "npcs",
    name: "Target",
    record: { name: "Target" },
    identified: true,
    effects: [],
    data: Object.assign({ curhp: START_HP, hitpoints: START_HP }, data),
  };
}

// Apply a roll and return how much damage was actually dealt (HP lost).
function damageDealt(target, roll, { half = false } = {}) {
  ctx.__state.lastSet = null;
  ctx.applyDamage(target, roll, half, null, false);
  const set = ctx.__state.lastSet || {};
  const newHp = "data.curhp" in set ? set["data.curhp"] : START_HP;
  return START_HP - newHp;
}

// A single-type damage roll, e.g. roll("fire", 10) -> 10 fire damage.
function roll(type, value, { traits = [], categories = [], critical = false } = {}) {
  return {
    types: [{ die: 6, value, type }],
    dice: [{ type: 6, value }],
    total: value,
    metadata: { traits, damageCategories: categories, damageType: type, critical },
  };
}

// A multi-type damage roll from [type, value] pairs.
function multiRoll(pairs, { traits = [], categories = [], damageType, critical = false } = {}) {
  return {
    types: pairs.map(([type, value]) => ({ die: 6, value, type })),
    dice: pairs.map(([, value]) => ({ type: 6, value })),
    total: pairs.reduce((s, [, v]) => s + v, 0),
    metadata: {
      traits,
      damageCategories: categories,
      damageType: damageType || pairs[0][0],
      critical,
    },
  };
}

const res = (type, value, extra = {}) => ({ data: { type, value, ...extra } });
const weak = (type, value, extra = {}) => ({ data: { type, value, ...extra } });
const imm = (type, extra = {}) => ({ data: { type, ...extra } });

// --- Resistances ----------------------------------------------------------

section("Resistances — specific type");
{
  const t = makeTarget({ resistances: [res("fire", 5)] });
  assert("fire 10 vs fire-resist-5 -> 5", damageDealt(t, roll("fire", 10)), 5);
  assert("cold 10 vs fire-resist-5 -> 10 (other type unaffected)", damageDealt(t, roll("cold", 10)), 10);
  assert("fire 3 vs fire-resist-5 -> 0 (cannot go negative)", damageDealt(t, roll("fire", 3)), 0);
}

section("Resistances — all damage");
{
  const t = makeTarget({ resistances: [res("all damage", 5)] });
  assert("fire 10 vs all-damage-5 -> 5", damageDealt(t, roll("fire", 10)), 5);
  assert("slashing 10 vs all-damage-5 -> 5", damageDealt(t, roll("slashing", 10)), 5);
  // hyphenated spelling resolves the same way
  const t2 = makeTarget({ resistances: [res("all-damage", 5)] });
  assert("fire 10 vs all-damage(hyphen)-5 -> 5", damageDealt(t2, roll("fire", 10)), 5);
}

section("Resistances — all damage with exception (the reported bug)");
{
  const t = makeTarget({ resistances: [res("all damage", 5, { exceptions: ["force"] })] });
  assert("force 10 vs all-damage-5-except-force -> 10 (excepted, full damage)", damageDealt(t, roll("force", 10)), 10);
  assert("fire 10 vs all-damage-5-except-force -> 5 (still resisted)", damageDealt(t, roll("fire", 10)), 5);

  const t2 = makeTarget({
    resistances: [res("all-damage", 5, { exceptions: ["force", "ghost-touch"] })],
  });
  assert("force excepted (multi-exception) -> 10", damageDealt(t2, roll("force", 10)), 10);
  assert("ghost-touch category excepted -> 10", damageDealt(t2, roll("slashing", 10, { categories: ["ghost-touch"] })), 10);
  assert("cold not excepted -> 5", damageDealt(t2, roll("cold", 10)), 5);
}

section("Resistances — doubleVs and material/category");
{
  const t = makeTarget({ resistances: [res("fire", 5, { doubleVs: ["non-magical"] })] });
  assert("non-magical fire 10 vs fire-resist-5 doubleVs non-magical -> 0 (10-10)", damageDealt(t, roll("fire", 10, { categories: ["non-magical"] })), 0);
  assert("magical fire 10 (no category) -> 5 (single resistance)", damageDealt(t, roll("fire", 10)), 5);

  const tMat = makeTarget({ resistances: [res("silver", 5)] });
  assert("silver-tagged slashing 10 vs silver-resist-5 -> 5", damageDealt(tMat, roll("slashing", 10, { categories: ["silver"] })), 5);
  assert("plain slashing 10 vs silver-resist-5 -> 10 (no material tag)", damageDealt(tMat, roll("slashing", 10)), 10);
}

// --- Immunities -----------------------------------------------------------

section("Immunities — specific type");
{
  const t = makeTarget({ immunities: [imm("fire")] });
  assert("fire 10 vs fire-immunity -> 0", damageDealt(t, roll("fire", 10)), 0);
  assert("cold 10 vs fire-immunity -> 10 (other type unaffected)", damageDealt(t, roll("cold", 10)), 10);
}

section("Immunities — all damage");
{
  const t = makeTarget({ immunities: [imm("all damage")] });
  assert("fire 10 vs all-damage-immunity -> 0", damageDealt(t, roll("fire", 10)), 0);
  const t2 = makeTarget({ immunities: [imm("all-damage")] });
  assert("fire 10 vs all-damage(hyphen)-immunity -> 0", damageDealt(t2, roll("fire", 10)), 0);
}

section("Immunities — with exception");
{
  const t = makeTarget({ immunities: [imm("all damage", { exceptions: ["force"] })] });
  assert("force 10 vs all-damage-immunity-except-force -> 10", damageDealt(t, roll("force", 10)), 10);
  assert("fire 10 vs all-damage-immunity-except-force -> 0", damageDealt(t, roll("fire", 10)), 0);
}

// --- Weaknesses -----------------------------------------------------------

section("Weaknesses");
{
  const t = makeTarget({ weaknesses: [weak("fire", 5)] });
  assert("fire 10 vs fire-weakness-5 -> 15", damageDealt(t, roll("fire", 10)), 15);
  assert("cold 10 vs fire-weakness-5 -> 10 (other type unaffected)", damageDealt(t, roll("cold", 10)), 10);

  const tAll = makeTarget({ weaknesses: [weak("all damage", 5)] });
  assert("acid 10 vs all-damage-weakness-5 -> 15", damageDealt(tAll, roll("acid", 10)), 15);

  const tExc = makeTarget({ weaknesses: [weak("all damage", 5, { exceptions: ["fire"] })] });
  assert("fire 10 vs all-damage-weakness-5-except-fire -> 10 (excepted)", damageDealt(tExc, roll("fire", 10)), 10);
  assert("cold 10 vs all-damage-weakness-5-except-fire -> 15", damageDealt(tExc, roll("cold", 10)), 15);
}

// --- Combined / interactions ---------------------------------------------

section("Weakness + Resistance same type (weakness then resistance)");
{
  const t = makeTarget({ weaknesses: [weak("fire", 5)], resistances: [res("fire", 2)] });
  // 10 + 5 (weakness) - 2 (resistance) = 13
  assert("fire 10, weak 5, resist 2 -> 13", damageDealt(t, roll("fire", 10)), 13);
}

section("Half damage (basic save success) applies before IWR");
{
  const t = makeTarget({ resistances: [res("fire", 3)] });
  // 10 halved -> 5, then -3 resistance -> 2
  assert("fire 10 halved then fire-resist-3 -> 2", damageDealt(t, roll("fire", 10), { half: true }), 2);
}

section("Critical doubles damage before IWR");
{
  const t = makeTarget({ resistances: [res("slashing", 5)] });
  // 10 doubled -> 20, then -5 -> 15
  assert("slashing 10 crit vs slashing-resist-5 -> 15", damageDealt(t, roll("slashing", 10, { critical: true }), {}), 15);
}

// --- Precision IWR --------------------------------------------------------

section("Precision damage — precision immunity");
{
  // 3 piercing base + 10 piercing precision; immune to precision -> only 3 base
  const t = makeTarget({ immunities: [imm("precision")] });
  const r = multiRoll([["piercing", 3], ["precision", 10]], { damageType: "piercing" });
  assert("3 piercing + 10 precision vs precision-immunity -> 3", damageDealt(t, r), 3);
}

section("Precision damage — precision resistance / weakness");
{
  const tRes = makeTarget({ resistances: [res("precision", 4)] });
  const r = multiRoll([["piercing", 3], ["precision", 10]], { damageType: "piercing" });
  // precision 10 - 4 = 6 surviving; + 3 base = 9
  assert("3 piercing + 10 precision vs precision-resist-4 -> 9", damageDealt(tRes, r), 9);

  const tWeak = makeTarget({ weaknesses: [weak("precision", 5)] });
  const r2 = multiRoll([["piercing", 3], ["precision", 2]], { damageType: "piercing" });
  // precision 2 + 5 weakness = 7 surviving; + 3 base = 10
  assert("3 piercing + 2 precision vs precision-weakness-5 -> 10", damageDealt(tWeak, r2), 10);
}

section("Precision damage — type resistance applies once (no double-dip)");
{
  // 3 piercing + 10 precision(piercing) = 13 piercing total, resist piercing 5 -> 8
  const t = makeTarget({ resistances: [res("piercing", 5)] });
  const r = multiRoll([["piercing", 3], ["precision", 10]], { damageType: "piercing" });
  assert("3 piercing + 10 precision vs piercing-resist-5 -> 8", damageDealt(t, r), 8);
}

section("Precision damage — precision immunity + type resistance together");
{
  // precision removed by immunity first, then resistance applies to remaining base
  const t = makeTarget({ immunities: [imm("precision")], resistances: [res("piercing", 2)] });
  const r = multiRoll([["piercing", 3], ["precision", 5]], { damageType: "piercing" });
  // precision 5 removed -> 3 piercing; -2 resistance -> 1
  assert("3 piercing + 5 precision vs precision-immune + piercing-resist-2 -> 1", damageDealt(t, r), 1);
}

// --- Exact reported scenario ---------------------------------------------

section("Phantasmal Minion (reported bug): dagger 3 force + 1 precision");
{
  // Mirrors the user's macro roll and the Phantasmal Minion stat block:
  //   resistances: all-damage 5 (except force, ghost-touch)
  //   immunities:  precision (among others)
  // Sneak Attack die is typed "precision"; base die is typed "force".
  // Expected: force (3) is excepted from resistance; the 1 precision is removed
  // by precision immunity -> total 3.
  const minion = makeTarget({
    immunities: [imm("disease"), imm("poison"), imm("precision"), imm("spirit")],
    resistances: [res("all-damage", 5, { exceptions: ["force", "ghost-touch"] })],
    traits: ["Medium", "Common", "Force", "Mindless"],
  });
  const daggerRoll = {
    types: [
      { die: 4, value: 3, type: "force" },
      { die: 6, value: 1, type: "precision" },
    ],
    dice: [
      { type: 4, value: 3 },
      { type: 6, value: 1 },
    ],
    total: 4,
    metadata: {
      traits: ["Common", "Agile", "Finesse", "Thrown-10", "Versatile-S"],
      damageCategories: ["non-magical"],
      critical: false,
      damageType: "piercing",
      criticalOnlyDice: [],
      precisionModifierIndices: [],
    },
  };
  assert("full damage -> 3 (force unresisted, precision immune)", damageDealt(minion, daggerRoll), 3);

  // The half-damage button on the same macro: 4 halved is 2 distributed as
  // force 1 + precision 1; force survives (1), precision removed by immunity ->
  // total 1.
  assert("half damage -> 1", damageDealt(minion, daggerRoll, { half: true }), 1);
}

// --- Where the damage comes from (engine group G2) -----------------------

// A target whose feature carries these modifiers (resistance, weakness,
// immunity, suppressIWR, harmedBy, voidHealing)
function withMods(mods, data = {}, extra = {}) {
  const t = makeTarget(data);
  t.data.features = [
    { _id: "feat", name: extra.featureName || "Feature", data: { modifiers: mods.map((m) => ({ data: { modifierType: "none", active: true, ...m } })) } },
  ];
  if (extra.effects) {
    t.effects = extra.effects;
    t.effectIds = extra.effects.map((e) => e._id);
  }
  return t;
}
// A roll with a damageSource on its metadata
function sourced(type, value, damageSource, extra = {}) {
  const r = roll(type, value, extra);
  r.metadata.damageSource = damageSource;
  if (extra.isSpell) r.metadata.isSpell = true;
  if (extra.ignoreResistances) r.metadata.damageIgnoresResistances = extra.ignoreResistances;
  if (extra.dual) r.metadata.isVitalityDual = true;
  return r;
}
const WEAPON = { type: "weapon", category: "martial", range: "melee", originTraits: ["humanoid"] };
const FIST = { type: "weapon", category: "unarmed", range: "melee", originTraits: ["humanoid"] };
const NPC_CLAW = { type: "melee", range: "melee", originTraits: ["undead", "zombie"] };
const NPC_JAWS_UNARMED = { type: "melee", category: "unarmed", range: "melee", originTraits: ["animal"] };
const ARCANE_SPELL = { type: "spell", traditions: ["arcane"], originTraits: ["humanoid"] };
const DIVINE_SPELL = { type: "spell", traditions: ["divine"], originTraits: ["humanoid"] };

section("Physical resistance is bludgeoning, piercing and slashing");
{
  const t = withMods([{ type: "resistance", field: "Physical", valueType: "number", value: "5" }]);
  assert("slashing 10 vs physical 5 -> 5", damageDealt(t, roll("slashing", 10)), 5);
  assert("bludgeoning 10 vs physical 5 -> 5", damageDealt(t, roll("bludgeoning", 10)), 5);
  assert("fire 10 vs physical 5 -> 10", damageDealt(t, roll("fire", 10)), 10);
  const listed = makeTarget({ resistances: [res("physical", 4)] });
  assert("record IWR list entry 'physical' 4: piercing 10 -> 6", damageDealt(listed, roll("piercing", 10)), 6);
  const both = withMods([{ type: "resistance", field: "Physical", valueType: "number", value: "3" }], { resistances: [res("slashing", 6)] });
  assert("a stronger slashing resistance is kept: slashing 10 -> 4", damageDealt(both, roll("slashing", 10)), 4);
  assert("... and physical 3 covers piercing: 10 -> 7", damageDealt(both, roll("piercing", 10)), 7);
  const weakT = withMods([{ type: "weakness", field: "Physical", valueType: "number", value: "2" }]);
  assert("physical weakness 2: slashing 10 -> 12", damageDealt(weakT, roll("slashing", 10)), 12);
  const immT = withMods([{ type: "immunity", field: "Physical", valueType: "string", value: "" }]);
  assert("physical immunity: piercing 10 -> 0", damageDealt(immT, roll("piercing", 10)), 0);
}

section("Fury Instinct: weapon damage only, not unarmed attacks (definition)");
{
  const fury = withMods([
    { type: "resistance", field: "Physical", valueType: "string", value: "{3+2}", definition: '[{"or":["item:type:weapon","item:type:melee"]},{"not":"item:category:unarmed"}]' },
  ]);
  assert("weapon slashing 10 -> 5", damageDealt(fury, sourced("slashing", 10, WEAPON)), 5);
  assert("NPC Strike piercing 10 -> 5", damageDealt(fury, sourced("piercing", 10, NPC_CLAW)), 5);
  assert("fist bludgeoning 10 -> 10 (unarmed)", damageDealt(fury, sourced("bludgeoning", 10, FIST)), 10);
  assert("NPC unarmed jaws 10 -> 10", damageDealt(fury, sourced("piercing", 10, NPC_JAWS_UNARMED)), 10);
  assert("spell bludgeoning 10 -> 10 (not a weapon)", damageDealt(fury, sourced("bludgeoning", 10, ARCANE_SPELL, { isSpell: true })), 10);
  assert("unknown source (old chat card) -> 10", damageDealt(fury, roll("slashing", 10)), 10);
  // Foundry's own spelling: exceptions with a definition
  const foundry = withMods([
    { type: "resistance", field: "Physical", valueType: "number", value: "5", exceptions: '[{"definition":[{"or":["item:type:melee","item:type:weapon"]},"item:category:unarmed"],"label":"Non-weapons"}]' },
  ]);
  assert("Foundry exceptions: weapon slashing 10 -> 5", damageDealt(foundry, sourced("slashing", 10, WEAPON)), 5);
  assert("Foundry exceptions: fist 10 -> 10", damageDealt(foundry, sourced("bludgeoning", 10, FIST)), 10);
}

section("Spirit Instinct: all damage from undead creatures (definition origin:mode:undead)");
{
  const spirit = withMods([
    { type: "resistance", field: "Void", valueType: "number", value: "6" },
    { type: "resistance", field: "Custom", valueType: "number", value: "6", definition: '["origin:mode:undead"]' },
  ]);
  assert("zombie's slashing 10 -> 4", damageDealt(spirit, sourced("slashing", 10, NPC_CLAW)), 4);
  assert("living attacker's slashing 10 -> 10", damageDealt(spirit, sourced("slashing", 10, WEAPON)), 10);
  assert("void 10 from anyone -> 4", damageDealt(spirit, roll("void", 10)), 4);
  assert("zombie's void 10: resisted once -> 4", damageDealt(spirit, sourced("void", 10, NPC_CLAW)), 4);
  const traitForm = withMods([{ type: "resistance", field: "", valueType: "number", value: "6", definition: '["origin:trait:undead"]' }]);
  assert("origin:trait:undead works too", damageDealt(traitForm, sourced("fire", 10, NPC_CLAW)), 4);
}

section("Superstition Instinct: spells of two traditions (definition)");
{
  const superstition = withMods([
    { type: "resistance", field: "Custom", valueType: "number", value: "6", definition: '["item:type:spell",{"or":["item:trait:arcane","item:trait:occult"]}]' },
  ]);
  assert("arcane spell fire 10 -> 4", damageDealt(superstition, sourced("fire", 10, ARCANE_SPELL, { isSpell: true })), 4);
  assert("divine spell fire 10 -> 10", damageDealt(superstition, sourced("fire", 10, DIVINE_SPELL, { isSpell: true })), 10);
  assert("weapon slashing 10 -> 10", damageDealt(superstition, sourced("slashing", 10, WEAPON)), 10);
  assert("spell with arcane in its traits (no tradition) -> 4", damageDealt(superstition, sourced("cold", 10, { type: "spell" }, { isSpell: true, traits: ["arcane", "cold"] })), 4);
  // The chosen pair as a toggle option the definition reads (the barbarian's own atoms are in it)
  const chosen = (option) => {
    const t = withMods([
      { type: "resistance", field: "Custom", valueType: "number", value: "6", definition: '["item:type:spell",{"or":[{"and":["superstition:arcane-occult",{"or":["item:trait:arcane","item:trait:occult"]}]},{"and":["superstition:divine-primal",{"or":["item:trait:divine","item:trait:primal"]}]}]}]' },
    ]);
    t.data.toggles = [{ name: "Superstition Instinct: pair", data: { predicateValue: option, toggled: true } }];
    return t;
  };
  assert("toggle arcane-occult: arcane spell resisted", damageDealt(chosen("superstition:arcane-occult"), sourced("fire", 10, ARCANE_SPELL, { isSpell: true })), 4);
  assert("toggle divine-primal: arcane spell not resisted", damageDealt(chosen("superstition:divine-primal"), sourced("fire", 10, ARCANE_SPELL, { isSpell: true })), 10);
  assert("toggle divine-primal: divine spell resisted", damageDealt(chosen("superstition:divine-primal"), sourced("fire", 10, DIVINE_SPELL, { isSpell: true })), 4);
}

section("Word exceptions on a modifier work like the IWR list's");
{
  const t = withMods([{ type: "resistance", field: "all damage", valueType: "number", value: "5", exceptions: "force, ghost-touch" }]);
  assert("force excepted -> 10", damageDealt(t, roll("force", 10)), 10);
  assert("ghost-touch category excepted -> 10", damageDealt(t, roll("slashing", 10, { categories: ["ghost-touch"] })), 10);
  assert("fire resisted -> 5", damageDealt(t, roll("fire", 10)), 5);
}

section("Devastator: ignore up to 10 resistance");
{
  assert("modifier text 'ignore physical resistance 10'", ctx.getDamageIgnoreList([{ valueType: "string", value: "ignore physical resistance 10" }], "resistance"), "physical:10");
  assert("modifier text 'ignore up to 10 physical resistance'", ctx.getDamageIgnoreList([{ valueType: "string", value: "ignore up to 10 physical resistance" }], "resistance"), "physical:10");
  assert("whole ignore unchanged: 'ignore fire resistance'", ctx.getDamageIgnoreList([{ valueType: "string", value: "ignore fire resistance" }], "resistance"), "fire");
  assert("immunity list unchanged", ctx.getDamageIgnoreList([{ valueType: "string", value: "ignore fire immunity" }], "immunity"), "fire");
  assert("inactive modifier ignored", ctx.getDamageIgnoreList([{ valueType: "string", value: "ignore physical resistance 10", active: false }], "resistance"), "");
  const big = makeTarget({ resistances: [res("slashing", 15)] });
  assert("slashing 20 vs resist 15, ignore up to 10 -> 15", damageDealt(big, sourced("slashing", 20, WEAPON, { ignoreResistances: "physical:10" })), 15);
  const small = makeTarget({ resistances: [res("slashing", 5)] });
  assert("slashing 20 vs resist 5, ignore up to 10 -> 20", damageDealt(small, sourced("slashing", 20, WEAPON, { ignoreResistances: "physical:10" })), 20);
  const fire = makeTarget({ resistances: [res("fire", 15)] });
  assert("fire is not physical: fire 20 vs 15 -> 5", damageDealt(fire, sourced("fire", 20, WEAPON, { ignoreResistances: "physical:10" })), 5);
  const all = makeTarget({ resistances: [res("all damage", 12)] });
  assert("all-damage resistance to physical: 20 - (12 - 10) -> 18", damageDealt(all, sourced("piercing", 20, WEAPON, { ignoreResistances: "physical:10" })), 18);
  assert("whole ignore still ignores it all", damageDealt(big, sourced("slashing", 20, WEAPON, { ignoreResistances: "slashing" })), 20);
}

section("Spell damage is of the 'spells' category (Curse of the Mortal Warrior)");
{
  const curse = withMods([{ type: "weakness", field: "Spells", valueType: "number", value: "3" }]);
  const spellRoll = roll("fire", 10);
  spellRoll.metadata.isSpell = true;
  assert("spell fire 10 (isSpell) -> 13", damageDealt(curse, spellRoll), 13);
  assert("the roll itself is not changed", spellRoll.metadata.damageCategories, []);
  assert("spell damageSource without isSpell -> 13", damageDealt(curse, sourced("cold", 10, ARCANE_SPELL)), 13);
  assert("weapon fire 10 -> 10", damageDealt(curse, sourced("fire", 10, WEAPON)), 10);
  const listed = makeTarget({ resistances: [res("spells", 4)] });
  assert("record resistance to spells: spell 10 -> 6", damageDealt(listed, sourced("fire", 10, ARCANE_SPELL, { isSpell: true })), 6);
}

// Vitality and void: the target is at half HP so healing shows
const HALF = { curhp: 500, hitpoints: 1000 };
function hpChange(target, r, options) {
  ctx.__state.lastSet = null;
  ctx.applyDamage(target, r, false, null, false, options);
  const set = ctx.__state.lastSet || {};
  return ("data.curhp" in set ? set["data.curhp"] : 500) - 500;
}
const VITALITY = (dual = false) => {
  const r = roll("vitality", 10, { traits: ["vitality", "healing"] });
  if (dual) r.metadata.isVitalityDual = true;
  return r;
};
const VOID = (dual = false) => {
  const r = roll("void", 10, { traits: ["void"] });
  if (dual) r.metadata.isVitalityDual = true;
  return r;
};

section("Void healing (Dhampir)");
{
  const living = withMods([], HALF);
  assert("living: vitality heals (unchanged)", hpChange(living, VITALITY()), 10);
  assert("living: void harms (unchanged)", hpChange(living, VOID()), -10);
  const dhampir = withMods([{ type: "voidHealing", valueType: "string", value: "" }], HALF);
  assert("void healing: vitality harms", hpChange(dhampir, VITALITY()), -10);
  assert("void healing: void heals", hpChange(dhampir, VOID()), 10);
  const gated = withMods([{ type: "voidHealing", valueType: "string", value: "", predicate: '["self:effect:never"]' }], HALF);
  assert("failed predicate: living again", hpChange(gated, VITALITY()), 10);
}

section("harmedBy (Curse of the Living Death)");
{
  const CURSEBOUND = { _id: "cursebound", name: "Cursebound", stackable: true, rules: [] };
  const oracle = (cursebound) =>
    withMods(
      [
        { type: "harmedBy", valueType: "string", value: "vitality", predicate: '["self:condition:cursebound"]' },
        { type: "harmedBy", valueType: "string", value: "void", predicate: '["self:condition:cursebound"]' },
      ],
      HALF,
      { effects: cursebound ? [CURSEBOUND] : [] },
    );
  assert("cursebound: vitality damage harms", hpChange(oracle(true), VITALITY()), -10);
  assert("not cursebound: vitality heals", hpChange(oracle(false), VITALITY()), 10);
  assert("cursebound: void harms (as for any living creature)", hpChange(oracle(true), VOID()), -10);
  // heal's Damage or Healing card: whoever applies it picks
  let prompted = null;
  const savedPrompt = ctx.api.showPrompt;
  ctx.api.showPrompt = (title, text, placeholder, options, query, cb) => {
    prompted = { title, options: options.map((o) => o.value), cb };
  };
  try {
    ctx.__state.lastSet = null;
    ctx.applyDamage(oracle(true), VITALITY(true), false, null, false);
    assert("dual card on a harmedBy target: asks Heal or Harm", prompted && prompted.options, ["heal", "harm"]);
    assert("... and changes nothing yet", ctx.__state.lastSet, null);
    ctx.__state.lastSet = null;
    prompted.cb(["harm"]);
    assert("Harm: 10 damage", ctx.__state.lastSet["data.curhp"], 490);
    ctx.__state.lastSet = null;
    prompted.cb("heal");
    assert("Heal: healed 10", ctx.__state.lastSet["data.curhp"], 510);
    prompted = null;
    assert("dual card without harmedBy: heals, no prompt", [hpChange(oracle(false), VITALITY(true)), prompted], [10, null]);
  } finally {
    ctx.api.showPrompt = savedPrompt;
  }
}

section("suppressIWR (Curse of the Living Death, Inclement Headwinds)");
{
  const CURSEBOUND = { _id: "cursebound", name: "Cursebound", stackable: true, rules: [] };
  const living = (cursebound) =>
    withMods(
      [{ type: "suppressIWR", field: "", valueType: "string", value: "vitality,void", predicate: '["self:condition:cursebound"]' }],
      { resistances: [res("void", 5)], immunities: [imm("vitality")] },
      { effects: cursebound ? [CURSEBOUND] : [] },
    );
  assert("cursebound: void resistance suppressed", damageDealt(living(true), roll("void", 10)), 10);
  assert("cursebound: vitality immunity suppressed", damageDealt(living(true), roll("vitality", 10)), 10);
  assert("not cursebound: void resisted", damageDealt(living(false), roll("void", 10)), 5);
  assert("not cursebound: vitality immunity", damageDealt(living(false), roll("vitality", 10)), 0);
  const headwinds = withMods(
    [{ type: "suppressIWR", field: "", valueType: "string", value: "electricity", predicate: '["item:type:spell","item:trait:electricity"]' }],
    { resistances: [res("electricity", 5)] },
  );
  assert("electricity spell: resistance suppressed", damageDealt(headwinds, sourced("electricity", 10, ARCANE_SPELL, { isSpell: true, traits: ["electricity"] })), 10);
  assert("electricity weapon: still resisted", damageDealt(headwinds, sourced("electricity", 10, WEAPON)), 5);
  const weakOnly = withMods(
    [{ type: "suppressIWR", field: "weakness", valueType: "string", value: "fire" }],
    { weaknesses: [weak("fire", 5)], resistances: [res("cold", 5)] },
  );
  assert("field weakness: fire weakness suppressed", damageDealt(weakOnly, roll("fire", 10)), 10);
  assert("field weakness: cold resistance kept", damageDealt(weakOnly, roll("cold", 10)), 5);
}

section("Strike materials from a modifier (Metal Strikes, engine group G3)");
{
  // The monk's fist Strike as performDamageRoll builds it
  const fist = { _id: "fist", name: "Fist", recordType: "items", data: { type: "weapon", carried: "equipped", itemCategory: "unarmed", group: "brawling", traits: ["agile", "finesse", "unarmed"], range: 0, damage: { dice: 1, die: "d4", damageType: "bludgeoning" }, runes: { potency: 0, striking: 0, property: [] } } };
  const monk = (mods) => ({ _id: "monk", recordType: "characters", effects: [], fields: {}, data: { level: 9, str: 3, inventory: [fist], feats: [{ _id: "ms", name: "Metal Strikes", recordType: "feats", data: { modifiers: mods.map((data) => ({ data })) } }], bonusFeats: [] } });
  const metal = [{ type: "weaponMaterial", modifierType: "none", valueType: "string", value: "cold-iron,silver", predicate: '["item:category:unarmed"]' }];
  const strike = (record) => {
    let metadata = {};
    const saved = ctx.api.promptRoll;
    ctx.api.promptRoll = (name, dice, mods, meta) => { metadata = meta; };
    ctx.performDamageRoll(record, fist, "data.inventory.0", false);
    ctx.api.promptRoll = saved;
    return { types: [{ die: 4, value: 10, type: "bludgeoning" }], dice: [{ type: 4, value: 10 }], total: 10, metadata };
  };
  const fiend = makeTarget({ weaknesses: [weak("cold-iron", 5)] });
  assert("Metal Strikes: cold iron weakness 5 applies (10 -> 15)", damageDealt(fiend, strike(monk(metal))), 15);
  assert("without it: 10", damageDealt(fiend, strike(monk([]))), 10);
  const were = makeTarget({ resistances: [res("physical", 5, { exceptions: ["silver"] })] });
  assert("physical 5 except silver: bypassed (10)", damageDealt(were, strike(monk(metal))), 10);
  assert("without it: resisted (5)", damageDealt(were, strike(monk([]))), 5);
  const byDefinition = withMods([{ type: "resistance", field: "", valueType: "number", value: "4", definition: '["item:material:silver"]' }]);
  assert("a definition reads item:material:silver (10 -> 6)", damageDealt(byDefinition, strike(monk(metal))), 6);
  assert("... and doesn't match an ordinary fist (10)", damageDealt(byDefinition, strike(monk([]))), 10);
}

section("Energy is acid, cold, electricity, fire, sonic, force, vitality and void (H12)");
{
  const t = makeTarget({ resistances: [res("energy", 5)] });
  assert("fire 10 vs energy 5 -> 5", damageDealt(t, roll("fire", 10)), 5);
  assert("sonic 10 vs energy 5 -> 5", damageDealt(t, roll("sonic", 10)), 5);
  assert("force 10 vs energy 5 -> 5", damageDealt(t, roll("force", 10)), 5);
  assert("slashing 10 vs energy 5 -> 10", damageDealt(t, roll("slashing", 10)), 10);
  const both = makeTarget({ resistances: [res("energy", 3), res("cold", 8)] });
  assert("a stronger cold resistance is kept: cold 10 -> 2", damageDealt(both, roll("cold", 10)), 2);
  const weakT = makeTarget({ weaknesses: [weak("energy", 4)] });
  assert("energy weakness 4: acid 10 -> 14", damageDealt(weakT, roll("acid", 10)), 14);
  const ignore = sourced("fire", 10, WEAPON, { ignoreResistances: "energy" });
  assert("ignore energy resistance: fire 10 -> 10", damageDealt(t, ignore), 10);
}

section("Holy and unholy by the attack's or spell's traits (H12)");
{
  const fiend = makeTarget({ weaknesses: [weak("holy", 10)] });
  assert("a holy spirit attack 6 vs holy weakness 10 -> 16", damageDealt(fiend, roll("spirit", 6, { traits: ["holy"] })), 16);
  assert("a holy-rune slashing Strike 6 -> 16", damageDealt(fiend, sourced("slashing", 6, { ...WEAPON, traits: ["holy", "magical"] })), 16);
  assert("spirit 6 without the trait -> 6", damageDealt(fiend, roll("spirit", 6)), 6);
  assert("unholy 6 against holy weakness -> 6", damageDealt(fiend, roll("spirit", 6, { traits: ["unholy"] })), 6);
  const celestial = makeTarget({ resistances: [res("unholy", 5)] });
  assert("unholy 10 vs unholy resistance 5 -> 5", damageDealt(celestial, roll("spirit", 10, { traits: ["Unholy"] })), 5);
}

section("Area damage and splash damage (H12, a swarm's weaknesses)");
{
  const swarm = makeTarget({ weaknesses: [weak("area-damage", 5), weak("splash damage", 5)] });
  assert("a spell with an area: fire 10 -> 15", damageDealt(swarm, sourced("fire", 10, { ...ARCANE_SPELL, area: true }, { isSpell: true })), 15);
  assert("a single-target spell: fire 10 -> 10", damageDealt(swarm, sourced("fire", 10, ARCANE_SPELL, { isSpell: true })), 10);
  ctx.__state.lastSet = null;
  ctx.applyDamage(swarm, roll("fire", 4), false, { type: "fire", value: 2 }, false);
  const set = ctx.__state.lastSet || {};
  assert("splash 2 applied on its own -> 7", START_HP - ("data.curhp" in set ? set["data.curhp"] : START_HP), 7);
  assert("the hit itself isn't splash: fire 4 -> 4", damageDealt(swarm, roll("fire", 4)), 4);
  assert("getDamageSource marks a spell with an area", ctx.getDamageSource(null, { recordType: "spells", name: "Fireball", data: { area: { type: "burst", value: 20 } } }).area, true);
  assert("... and not one without", ctx.getDamageSource(null, { recordType: "spells", name: "Shocking Grasp", data: {} }).area, undefined);
}

section("Legacy damage types are the remaster's (H12)");
{
  const legacy = makeTarget({ resistances: [res("negative", 5)], weaknesses: [weak("good", 10)] });
  assert("legacy negative 10 vs legacy negative resistance 5 -> 5", damageDealt(legacy, roll("negative", 10)), 5);
  assert("remaster void 10 vs legacy negative resistance 5 -> 5", damageDealt(legacy, roll("void", 10)), 5);
  assert("legacy good 6 vs legacy good weakness 10 -> 16 (spirit, holy)", damageDealt(legacy, roll("good", 6)), 16);
  assert("a remaster holy attack vs legacy good weakness -> 16", damageDealt(legacy, roll("spirit", 6, { traits: ["holy"] })), 16);
  const remaster = makeTarget({ resistances: [res("vitality", 5)] });
  assert("legacy positive 10 vs vitality resistance 5 -> 5", damageDealt(remaster, roll("positive", 10)), 5);
  const both = makeTarget({ resistances: [res("negative", 8), res("void", 3)] });
  assert("the stronger of legacy and remaster is kept: void 10 -> 2", damageDealt(both, roll("void", 10)), 2);
}

section("Condition immunities: the GM is asked (H12)");
{
  const confirms = [];
  let answer = false;
  ctx.api.showConfirm = (title, message, yes, no, onYes) => {
    confirms.push(message);
    if (answer) onYes();
  };
  const golem = makeTarget({ immunities: [imm("paralyzed"), imm("Frightened")] });
  const turret = makeTarget({ immunities: [imm("object immunities")] });
  assert("immune to paralyzed", ctx.getConditionImmunity(golem, "Paralyzed"), "paralyzed");
  assert("immune to frightened (any case)", ctx.getConditionImmunity(golem, "frightened"), "frightened");
  assert("not to slowed", ctx.getConditionImmunity(golem, "Slowed"), null);
  assert("object immunities cover sickened", ctx.getConditionImmunity(turret, "Sickened"), "object immunities");
  assert("... but not prone", ctx.getConditionImmunity(turret, "Prone"), null);

  let added = 0;
  ctx.addConditionGain(golem, "Paralyzed", 1, (stacks) => (added += stacks));
  assert("asked, nothing added on Cancel", [confirms.length, added], [1, 0]);
  assertIncludes("the question names it", confirms[0], "is immune to paralyzed. Apply it anyway?");
  answer = true;
  ctx.addConditionGain(golem, "Paralyzed", 1, (stacks) => (added += stacks));
  assert("Apply Anyway adds it", added, 1);
  ctx.addConditionGain(makeTarget({}), "Paralyzed", 1, (stacks) => (added += stacks));
  assert("not immune: added without asking", [confirms.length, added], [2, 2]);
}

section("Only the highest weakness applies to the same damage (Sean's review of #30)");
{
  const demon = makeTarget({ weaknesses: [weak("cold-iron", 5), weak("holy", 5)] });
  const holyColdIron = sourced("slashing", 10, { ...WEAPON, traits: ["holy"] }, { categories: ["cold-iron"] });
  assert("a holy cold-iron Strike 10 on a demon weak to both 5 -> 15, not 20", damageDealt(demon, holyColdIron), 15);
  const swarm = makeTarget({ weaknesses: [weak("fire", 5), weak("area-damage", 5)] });
  const fireball = sourced("fire", 10, { ...ARCANE_SPELL, area: true }, { isSpell: true });
  assert("Fireball 10 on a swarm weak to fire 5 and area 5 -> 15, not 20", damageDealt(swarm, fireball), 15);
  const higherArea = makeTarget({ weaknesses: [weak("fire", 3), weak("area-damage", 8)] });
  assert("... the higher of fire 3 and area 8 -> 18", damageDealt(higherArea, fireball), 18);
  const allAndType = makeTarget({ weaknesses: [weak("fire", 4), weak("all-damage", 2)] });
  assert("fire 4 and all damage 2: fire 10 -> 14", damageDealt(allAndType, roll("fire", 10)), 14);
  const doubled = makeTarget({ weaknesses: [weak("holy", 3, { doubleVs: ["non-magical"] }), weak("cold-iron", 5)] });
  const plainHoly = sourced("slashing", 10, { ...WEAPON, traits: ["holy"] }, { categories: ["cold-iron", "non-magical"] });
  assert("doubleVs counts before the highest is taken (holy 3x2=6 over cold iron 5) -> 16", damageDealt(doubled, plainHoly), 16);
  const excepted = makeTarget({ weaknesses: [weak("holy", 9, { exceptions: ["cold-iron"] }), weak("cold-iron", 5)] });
  assert("an exception drops that weakness from the choice (holy 9 except cold iron) -> 15", damageDealt(excepted, holyColdIron), 15);
  const types = multiRoll([["slashing", 10], ["fire", 4]], { categories: ["cold-iron"] });
  const coldIronFire = makeTarget({ weaknesses: [weak("cold-iron", 5), weak("fire", 2)] });
  assert("per damage type: slashing gets cold iron 5, fire the higher of cold iron 5 and fire 2 -> 24", damageDealt(coldIronFire, types), 24);
}

section("Splash weakness on the primary target too (Sean's review of #30)");
{
  const swarm = makeTarget({ weaknesses: [weak("splash-damage", 5)] });
  const bomb = roll("fire", 4);
  bomb.metadata.splashDamage = "1";
  assert("a bomb hit with splash 1 on a swarm weak to splash 5 -> 9", damageDealt(swarm, bomb), 9);
  const noSplash = roll("fire", 4);
  noSplash.metadata.splashDamage = "";
  assert("no splash on the weapon -> 4", damageDealt(swarm, noSplash), 4);
  const fireToo = makeTarget({ weaknesses: [weak("splash-damage", 5), weak("fire", 3)] });
  assert("splash 5 and fire 3: only the higher -> 9", damageDealt(fireToo, bomb), 9);
}

section("Hazards have object immunities (Sean's review of #30)");
{
  const hazard = makeTarget({ type: "hazard" });
  assert("a hazard: paralyzed is covered by object immunities", ctx.getConditionImmunity(hazard, "Paralyzed"), "object immunities");
  assert("a hazard takes no bleed damage", damageDealt(hazard, roll("bleed", 5)), 0);
  assert("... but fire as usual", damageDealt(hazard, roll("fire", 5)), 5);
  assert("a creature isn't covered", ctx.getConditionImmunity(makeTarget({ type: "creature" }), "Paralyzed"), null);
}

process.exit(summary());
