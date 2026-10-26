// Tests for property runes (rollhandlers/property-runes.js): what weapon
// runes add to their own weapon's Strikes (damage, critical-only damage,
// resistances ignored, attack card notes, keen, traits and range), the
// target atoms some of them key off, legacy and named runes, armor runes'
// resistances, item bonuses and persistent damage DCs, and fortification's
// flat check against critical hits.
// Run: node tests/test-property-runes.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// --- helpers ----------------------------------------------------------------

// A feat carrying the given modifier data entries
const feat = (name, modifiers) => ({
  _id: `feat-${name}`,
  name,
  recordType: "feats",
  data: { type: "general", level: 1, modifiers: modifiers.map((data) => ({ data })) },
});

// A level 5 character with the given inventory
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

// An equipped weapon with the given property runes
const weapon = (name, property = [], extra = {}) => ({
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
    runes: { potency: 1, striking: 0, property },
    ...extra,
  },
});

// Worn armor with the given property runes; invested unless said otherwise
const armor = (property, { invested = "true", carried = "equipped" } = {}) => ({
  _id: `armor-${property.join("-")}`,
  name: "Breastplate",
  recordType: "items",
  data: { type: "armor", carried, invested, itemCategory: "medium", runes: { potency: 1, resilient: 0, property } },
});

// A target for api.getTargets
const target = (traits = [], data = {}, extra = {}) => ({
  token: { _id: "t", name: "Target", recordType: "npcs", effects: [], effectIds: [], data: { ac: 15, level: 1, traits, ...data }, ...extra },
  distance: 5,
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

// The Strike's metadata against the given targets (none: no target)
function strike(record, item, targets = []) {
  const saved = ctx.api.getTargets;
  ctx.api.getTargets = () => targets;
  try {
    return capturePrompt(() => ctx.performAttackRoll(record, item, "data.inventory.0", 1)).metadata;
  } finally {
    ctx.api.getTargets = saved;
  }
}

function runHandler(file, data) {
  ctx.__state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return ctx.__state.messages.join("\n");
}

// The attack card for a d20 result against DC 18 with this metadata
const attackCard = (d20, metadata, bonus = 5) =>
  runHandler("attack.js", {
    roll: { dice: [{ type: 20, value: d20 }], total: d20 + bonus, metadata: { dc: 18, attack: "Longsword", traits: [], damage: "1d8 slashing", ...metadata } },
  });

const named = (mods, name) => (mods || []).filter((mod) => mod.name === name);
const values = (mods, name) => named(mods, name).map((mod) => mod.value);
const lookup = (record, types, field, context = {}) =>
  ctx.getEffectsAndModifiersForToken(record, types, field, undefined, undefined, context);

ctx.api.getToken = () => ({ _id: "pc-token", data: {} });
ctx.api.getOtherTokens = () => [];

// --- tests --------------------------------------------------------------------

section("Rune keys: Foundry slugs, names and legacy runes");
{
  assert("Foundry slug", ctx.getPropertyRuneKey("greaterFlaming"), "greaterflaming");
  assert("a name, as weaponRune adds it", ctx.getPropertyRuneKey("Ghost Touch"), "ghosttouch");
  assert("speed is quickstrike", ctx.getPropertyRuneKey("speed"), "quickstrike");
  assert("disrupting is vitalizing", ctx.getPropertyRuneKey("disrupting"), "vitalizing");
  assert("greater disrupting", ctx.getPropertyRuneKey("greaterDisrupting"), "greatervitalizing");
  assert("spell-storing is spell reservoir", ctx.getPropertyRuneKey("spell-storing"), "spellreservoir");
  assert("dancing is animated", ctx.getPropertyRuneKey("dancing"), "animated");
  assert("Kol's Oath by its name: Foundry's kolssOath", ctx.getPropertyRuneKey("Greater Kol's Oath"), "greaterkolssoath");
  assert("rune details by any of these", [ctx.getWeaponRuneDetails("speed").displayName, ctx.getWeaponRuneDetails("Ghost Touch").displayName], ["Quickstrike", "Ghost Touch"]);
  assert("Major Rooting, as the item sheet stores it, has its details", ctx.getWeaponRuneDetails("majorRooting").displayName, "Major Rooting");
  assert("armor runes too", ctx.getArmorRuneDetails("greaterFortification").displayName, "Greater Fortification");

  const weaponEffects = vm.runInContext("WEAPON_RUNE_EFFECTS", ctx);
  const foundryOnly = Object.keys(weaponEffects).filter((key) => !ctx.getWeaponRuneDetails(key).displayName);
  assert("every weapon rune with effects has the ruleset's details, but Foundry's two energy vulnerability runes", foundryOnly, ["energyvulnerability", "greaterenergyvulnerability"]);
  const armorEffects = vm.runInContext("ARMOR_RUNE_EFFECTS", ctx);
  assert("every armor rune with effects has the ruleset's details", Object.keys(armorEffects).filter((key) => !ctx.getArmorRuneDetails(key).displayName), []);
  assert("58 weapon runes and 26 armor runes have effects", [Object.keys(weaponEffects).length, Object.keys(armorEffects).length], [58, 26]);
}

section("Damage on the rune's own weapon");
{
  const flaming = weapon("Longsword", ["flaming"]);
  const plainDagger = weapon("Dagger", [], { traits: ["agile", "finesse"], damage: { dice: 1, die: "d4", damageType: "piercing" } });
  let card = strike(pc({ inventory: [flaming, plainDagger] }), flaming);
  assert("flaming: 1d6 fire", values(card.damageModifiers, "Flaming"), ["1d6 fire"]);
  assert("and 1d10 persistent fire only on a critical hit", [card.criticalPersistentDamage, card.persistentDamage || ""], ["1d10 fire", ""]);
  card = strike(pc({ inventory: [plainDagger, flaming] }), plainDagger);
  assert("not on another weapon", [named(card.damageModifiers, "Flaming").length, card.criticalPersistentDamage || ""], [0, ""]);

  const greater = weapon("Longsword", ["greaterFlaming"]);
  card = strike(pc({ inventory: [greater] }), greater);
  assert("greater flaming: 2d10 persistent fire on a critical hit", card.criticalPersistentDamage, "2d10 fire");
  assertIncludes("and its fire ignores resistance", String(card.damageIgnoresResistances).split(","), "fire");

  const shock = weapon("Longsword", ["shock"]);
  card = strike(pc({ inventory: [shock] }), shock);
  assert("shock: 1d6 electricity, once (moved from PF2e.js)", values(card.damageModifiers, "Shock"), ["1d6 electricity"]);
  const greaterShock = weapon("Longsword", ["greaterShock"]);
  card = strike(pc({ inventory: [greaterShock] }), greaterShock);
  assert("greater shock still ignores electricity resistance", String(card.damageIgnoresResistances).split(","), ["electricity"]);

  const wounding = weapon("Longsword", ["wounding"]);
  card = strike(pc({ inventory: [wounding] }), wounding);
  assert("wounding: 1d6 persistent bleed", card.persistentDamage, "1d6 bleed");
  const ashen = weapon("Longsword", ["ashen"]);
  card = strike(pc({ inventory: [ashen] }), ashen);
  assert("ashen: 1d4 persistent fire on any hit", card.persistentDamage, "1d4 fire");

  const decaying = weapon("Longsword", ["decaying"]);
  card = strike(pc({ inventory: [decaying] }), decaying);
  assert("decaying: 1d4 void, and 2d4 persistent void on a critical hit", [values(card.damageModifiers, "Decaying"), card.criticalPersistentDamage], [["1d4 void"], "2d4 void"]);

  const crit = capturePrompt(() => ctx.performDamageRoll(pc({ inventory: [flaming] }), flaming, "data.inventory.0", true));
  assert("a critical damage roll carries the persistent fire", crit.metadata.criticalPersistentDamage, "1d10 fire");
  const hit = capturePrompt(() => ctx.performDamageRoll(pc({ inventory: [flaming] }), flaming, "data.inventory.0", false));
  assert("a normal one doesn't", hit.metadata.criticalPersistentDamage, "");

  const hammer = weapon("Warhammer", ["shockwave"], { group: "hammer", damage: { dice: 1, die: "d8", damageType: "bludgeoning" } });
  hammer.data.runes.striking = 1;
  card = strike(pc({ inventory: [hammer] }), hammer);
  assert("shockwave: bludgeoning splash equal to the weapon's damage dice", card.splashDamage, "2 bludgeoning");
  const slashingShockwave = weapon("Longsword", ["shockwave"]);
  card = strike(pc({ inventory: [slashingShockwave] }), slashingShockwave);
  assert("not on a slashing weapon", Number(card.splashDamage) || 0, 0);
}

section("Damage against some targets");
{
  const brilliant = weapon("Longsword", ["brilliant"]);
  const record = pc({ inventory: [brilliant] });
  const active = (card) => (card.damageModifiers || []).filter((mod) => mod.name === "Brilliant" && mod.active !== false && !mod.situational).map((mod) => mod.value);
  assert("brilliant vs a fiend: fire and spirit", active(strike(record, brilliant, [target(["Fiend"])])), ["1d4 fire", "1d4 spirit"]);
  assert("vs an undead: fire and vitality", active(strike(record, brilliant, [target(["Undead"])])), ["1d4 fire", "1d4 vitality"]);
  assert("vs anything else: fire", active(strike(record, brilliant, [target(["Humanoid"])])), ["1d4 fire"]);
  const offered = (strike(record, brilliant).damageModifiers || []).filter((mod) => mod.name.startsWith("Brilliant") && mod.situational).length;
  assert("with no target, the target-only damage is offered to tick", offered, 2);

  const holy = weapon("Longsword", ["holy"]);
  const holyRecord = pc({ inventory: [holy] });
  const holyMods = (card) => (card.damageModifiers || []).filter((mod) => mod.name.startsWith("Holy"));
  const spirit = (card) => holyMods(card).filter((mod) => mod.active !== false && !mod.situational).map((mod) => mod.value);
  assert("holy vs an unholy target: 2d4 spirit", spirit(strike(holyRecord, holy, [target(["Unholy", "Fiend"])])), ["1d4 spirit", "1d4 spirit"]);
  assert("vs another: 1d4", spirit(strike(holyRecord, holy, [target(["Humanoid"])])), ["1d4 spirit"]);
  const noTarget = holyMods(strike(holyRecord, holy));
  assert("with no target: 1d4", spirit({ damageModifiers: noTarget }), ["1d4 spirit"]);
  assert("and ticking vs unholy makes it 2d4, not 3d4", noTarget.filter((mod) => mod.situational).map((mod) => mod.value), ["1d4 spirit"]);
  const unholyWeapon = weapon("Longsword", ["unholy"]);
  const unholySpirit = (card) => (card.damageModifiers || []).filter((mod) => mod.name.startsWith("Unholy") && mod.active !== false && !mod.situational).map((mod) => mod.value);
  assert("the extra die is its own line", holyMods(strike(holyRecord, holy, [target(["Unholy"])])).map((mod) => mod.name), ["Holy", "Holy (extra)"]);
  assert("unholy vs a holy target: 2d4 spirit", unholySpirit(strike(pc({ inventory: [unholyWeapon] }), unholyWeapon, [target(["Holy"])])), ["1d4 spirit", "1d4 spirit"]);
  assertIncludes("its Strikes have the holy trait", strike(holyRecord, holy).traits, "holy");
  const unholy = weapon("Longsword", ["unholy"]);
  assertIncludes("unholy's the unholy trait", strike(pc({ inventory: [unholy] }), unholy).traits, "unholy");

  const vitalizing = weapon("Longsword", ["vitalizing"]);
  const vRecord = pc({ inventory: [vitalizing] });
  assert("vitalizing vs undead: 1d6 persistent vitality", strike(vRecord, vitalizing, [target(["Undead"])]).persistentDamage, "1d6 vitality");
  assert("vs the living: nothing", strike(vRecord, vitalizing, [target(["Animal"])]).persistentDamage || "", "");
  const legacy = weapon("Longsword", ["disrupting"]);
  assert("an item with the legacy disrupting rune works the same", strike(pc({ inventory: [legacy] }), legacy, [target(["Undead"])]).persistentDamage, "1d6 vitality");

  const deathdrinking = weapon("Longsword", ["deathdrinking"]);
  const dRecord = pc({ inventory: [deathdrinking] });
  const riders = (card) => (card.damageModifiers || []).filter((mod) => mod.name === "Deathdrinking" && mod.criticalOnly && mod.active !== false && !mod.situational).map((mod) => mod.value);
  assert("deathdrinking vs the living: 1d6 void on a critical hit", riders(strike(dRecord, deathdrinking, [target(["Humanoid"])])), ["1d6 void"]);
  assert("vs undead: 1d6 vitality instead", riders(strike(dRecord, deathdrinking, [target(["Undead"])])), ["1d6 vitality"]);
  assert("vs a construct: neither", riders(strike(dRecord, deathdrinking, [target(["Construct"])])), []);

  const giantKilling = weapon("Longsword", ["giantKilling"]);
  const giantName = ctx.getWeaponRuneDetails("giantKilling").displayName;
  assert("giant-killing vs a giant: 1d6 mental", values(strike(pc({ inventory: [giantKilling] }), giantKilling, [target(["Giant"])]).damageModifiers, giantName), ["1d6 mental"]);
}

section("Target atoms: void healing and mode of being");
{
  const atoms = (traits, data = {}, extra = {}) => ctx.getTargetAtoms(pc(), { target: target(traits, data, extra) });
  assertIncludes("an undead target has negative healing", atoms(["Undead"]), "target:negative-healing");
  assertIncludes("and is undead", atoms(["Undead"]), "target:mode:undead");
  assertNotIncludes("a living one doesn't", atoms(["Humanoid"]), "target:negative-healing");
  assertIncludes("and is living", atoms(["Humanoid"]), "target:mode:living");
  assertIncludes("a construct", atoms(["Construct"]), "target:mode:construct");
  assertIncludes("an undead eidolon is living", atoms(["Undead", "Eidolon"]), "target:mode:living");
  const voidHealing = { name: "Void Healing", data: { modifiers: [{ data: { type: "voidHealing", active: true } }] } };
  const dhampir = atoms(["Human"], { heritages: [{ name: "Dhampir", data: { features: [voidHealing] } }] }, { recordType: "characters" });
  assertIncludes("a voidHealing modifier counts (Dhampir), as in applyDamage", dhampir, "target:negative-healing");
  assertIncludes("but the dhampir is living", dhampir, "target:mode:living");
  assertIncludes("an NPC's own features too", atoms(["Humanoid"], { features: [voidHealing] }), "target:negative-healing");
  const gated = { name: "Void Healing", data: { modifiers: [{ data: { type: "voidHealing", active: true, predicate: '["self:effect:never"]' } }] } };
  assertNotIncludes("unless its predicate fails", atoms(["Humanoid"], { features: [gated] }), "target:negative-healing");
}

section("Notes on the attack card");
{
  const frost = weapon("Longsword", ["frost"]);
  const card = strike(pc({ inventory: [frost] }), frost);
  const note = (card.notes || []).find((n) => n.name === "Frost");
  assert("frost's note, for a critical hit", note?.outcome, [2]);
  assertIncludes("the card shows it on a critical hit", attackCard(19, card, 10), "**Frost:** On a critical hit, the target is also Slowed 1 until the end of your next turn unless it succeeds at a DC 24 Fortitude save.");
  assertNotIncludes("not on a hit", [attackCard(14, card)], "Frost:");
  const ashen = weapon("Longsword", ["ashen"]);
  const ashenCard = strike(pc({ inventory: [ashen] }), ashen);
  assertIncludes("ashen's note on any hit", attackCard(14, ashenCard), "**Ashen:**");
  assert("but not on a miss", attackCard(5, ashenCard).includes("Ashen:"), false);
  const giantKilling = weapon("Longsword", ["giantKilling"]);
  const gkRecord = pc({ inventory: [giantKilling] });
  const giantName = ctx.getWeaponRuneDetails("giantKilling").displayName;
  assert("a note for some targets only: vs a giant", (strike(gkRecord, giantKilling, [target(["Giant"])]).notes || []).some((n) => n.name === giantName), true);
  assert("not vs another", (strike(gkRecord, giantKilling, [target(["Humanoid"])]).notes || []).some((n) => n.name === giantName && !n.situational), false);
  const plain = weapon("Dagger");
  assert("none on another weapon", (strike(pc({ inventory: [plain, frost] }), plain).notes || []).length, 0);
}

section("Keen: a critical hit on a 19");
{
  const keen = weapon("Longsword", ["keen"]);
  const card = strike(pc({ inventory: [keen] }), keen);
  assert("a natural 19 that hits is a critical hit", attackCard(19, card, 0).includes("CRITICAL HIT"), true);
  assert("a natural 19 that misses stays a miss", attackCard(19, { ...card, dc: 25 }, 0).includes("MISS"), true);
  assert("a natural 18 that hits is a hit", attackCard(18, card, 0).includes("CRITICAL HIT"), false);
  const club = weapon("Club", ["keen"], { group: "club", damage: { dice: 1, die: "d6", damageType: "bludgeoning" } });
  const clubCard = strike(pc({ inventory: [club] }), club);
  assert("not on a bludgeoning weapon", attackCard(19, clubCard, 0).includes("CRITICAL HIT"), false);
}

section("Traits and range");
{
  const hooked = weapon("Longsword", ["hooked"]);
  assertIncludes("hooked: the trip trait", ctx.getAlteredWeapon(pc({ inventory: [hooked] }), hooked).data.traits, "trip");
  const merciful = weapon("Longsword", ["merciful"]);
  assertIncludes("merciful: nonlethal", ctx.getAlteredWeapon(pc({ inventory: [merciful] }), merciful).data.traits, "nonlethal");
  const bow = weapon("Longbow", ["impossible"], { range: 100, group: "bow" });
  assert("impossible: double range", ctx.getAlteredWeapon(pc({ inventory: [bow] }), bow).data.range, 200);
  const sword = weapon("Shortsword");
  assertNotIncludes("only on its own weapon", ctx.getAlteredWeapon(pc({ inventory: [sword, hooked] }), sword).data.traits, "trip");
  const ghostHunter = feat("Ghost Hunter", [{ type: "weaponTrait", value: "ghost-touch-test" }]);
  assertIncludes("feats' weapon traits still apply", ctx.getAlteredWeapon(pc({ feats: [ghostHunter], inventory: [sword] }), sword).data.traits, "ghost-touch-test");
}

section("Armor runes");
{
  const resistant = armor(["fireResistant", "greaterAcidResistant"]);
  let iwr = ctx.getIWR(pc({ inventory: [resistant] }));
  assert("energy-resistant: fire 5 and acid 10", [iwr.resistances?.fire?.value, iwr.resistances?.acid?.value], [5, 10]);
  iwr = ctx.getIWR(pc({ inventory: [armor(["fireResistant"], { invested: "false" })] }));
  assert("not without investment", iwr.resistances?.fire, undefined);
  iwr = ctx.getIWR(pc({ inventory: [armor(["fireResistant"], { carried: "carried" })] }));
  assert("or when not worn", iwr.resistances?.fire, undefined);
  iwr = ctx.getIWR({ ...pc({ inventory: [armor(["coldResistant"], { invested: "false" })] }), recordType: "npcs" });
  assert("an NPC's armor needs no investment", iwr.resistances?.cold?.value, 5);

  const stealth = (property) => lookup(pc({ inventory: [armor(property)] }), ["skillBonus"], "stealth").filter((mod) => mod.active).map((mod) => [mod.type, mod.value]);
  assert("shadow: +1 item bonus to Stealth", stealth(["shadow"]), [["item", 1]]);
  assert("major shadow: +3", stealth(["majorShadow"]), [["item", 3]]);
  const slick = pc({ inventory: [armor(["greaterSlick"])] });
  const escape = lookup(slick, ["skillBonus"], "acrobatics", { action: { name: "Escape" } }).filter((mod) => mod.name === "Greater Slick");
  assert("slick: +2 to Escape", [escape[0]?.active, escape[0]?.value], [true, 2]);
  const balance = lookup(slick, ["skillBonus"], "acrobatics", { action: { name: "Balance" } }).filter((mod) => mod.name === "Greater Slick" && mod.active);
  assert("not to Balance", balance.length, 0);
  const deception = lookup(pc({ inventory: [armor(["sinisterKnight"])] }), ["skillBonus"], "deception").filter((mod) => mod.active).map((mod) => mod.value);
  assert("sinister knight: +1 to Deception", deception, [1]);

  const quenching = pc({ inventory: [armor(["greaterQuenching", "stanching"])] });
  assert("greater quenching: fire DC 10", ctx.getPersistentRecoveryDC(quenching, "1d6 fire"), 10);
  assert("acid too", ctx.getPersistentRecoveryDC(quenching, "2 acid"), 10);
  assert("stanching: bleed DC 12", ctx.getPersistentRecoveryDC(quenching, "1d4 bleed"), 12);
  assert("cold stays DC 15", ctx.getPersistentRecoveryDC(quenching, "1d6 cold"), 15);
  assert("true quenching: DC 5", ctx.getPersistentRecoveryDC(pc({ inventory: [armor(["trueQuenching"])] }), "1d6 fire"), 5);
}

section("Fortification");
{
  assert("fortification: DC 17", ctx.getFortification(pc({ inventory: [armor(["fortification"])] })), { dc: 17, name: "Fortification" });
  assert("greater: DC 14", ctx.getFortification(pc({ inventory: [armor(["greaterFortification"])] })), { dc: 14, name: "Greater Fortification" });
  assert("not without investment", ctx.getFortification(pc({ inventory: [armor(["fortification"], { invested: "false" })] })), null);
  assert("an NPC's armor counts without", ctx.getFortification({ ...pc({ inventory: [armor(["fortification"], { invested: "false" })] }), recordType: "npcs" }), { dc: 17, name: "Fortification" });
  assert("no armor: none", ctx.getFortification(pc()), null);

  const sword = weapon("Longsword", ["frost"]);
  const wearer = { ...pc({ inventory: [armor(["fortification"])] }), _id: "t", name: "Target" };
  const card = strike(pc({ inventory: [sword] }), sword, [{ token: wearer, distance: 5 }]);
  assert("the Strike's metadata carries the target's fortification", card.fortification, { dc: 17, name: "Fortification" });
  assert("none against a target without", strike(pc({ inventory: [sword] }), sword, [target([])]).fortification, null);

  let rolls = [];
  ctx.api.rollInstant = (dice) => {
    rolls.push(dice);
    return { total: rolls.length === 1 ? nextFlat : 0 };
  };
  let nextFlat = 17;
  const critical = { ...card, dc: 18 };
  let text = attackCard(19, critical, 10);
  assert("a critical hit rolls the flat check", rolls, ["1d20"]);
  assert("17 vs DC 17: a normal hit", [text.includes("CRITICAL HIT"), text.includes("HIT")], [false, true]);
  assertIncludes("the card says so", text, "**Fortification:** DC 17 flat check: 17, the critical hit becomes a normal hit.");
  assertNotIncludes("and the critical hit's note is gone", [text], "Frost:");
  rolls = [];
  nextFlat = 16;
  text = attackCard(19, critical, 10);
  assert("16: the critical hit stands", text.includes("CRITICAL HIT"), true);
  assertIncludes("and says so", text, "the critical hit stands.");
  assertIncludes("with the note", text, "**Frost:**");
  rolls = [];
  attackCard(14, critical, 10);
  assert("a normal hit rolls nothing", rolls, []);
  attackCard(19, { ...critical, fortification: null }, 10);
  assert("nor a critical hit on a target without", rolls, []);

  // A spell attack against the same target
  const ray = { name: "Ray", data: { defense: { passive: { statistic: "ac" } }, traits: [], damage: [] } };
  const caster = { ...pc(), _id: "caster" };
  const macro = ctx.getSpellAttackMacro(caster, ray, { data: { dc: 20, attribute: "cha", attack: 10 } }, "data.spells.0", null);
  const body = String(macro).replace(/^```Roll_Attack\n/, "").replace(/```\s*$/, "");
  const saved = { ...ctx.api };
  let captured = null;
  ctx.api.getRecord = (type, id, cb) => cb(caster);
  ctx.api.getValueOnRecord = (r, path) => (path === "data.spells.0" ? ray : null);
  ctx.api.getTargets = () => [{ token: wearer, distance: 30 }];
  ctx.api.promptRoll = (name, dice, modifiers, metadata) => (captured = { modifiers, metadata });
  try {
    new vm.Script(body, { filename: "spell-attack-macro.js" }).runInContext(ctx);
  } finally {
    Object.assign(ctx.api, saved);
  }
  assert("a spell attack carries it too", captured?.metadata?.fortification, { dc: 17, name: "Fortification" });
}

section("Clan dagger filigrees, antimagic, rock-braced, soaring");
{
  const dagger = (rune) => weapon("Clan Dagger", [rune], { group: "knife", traits: ["agile", "dwarf", "parry", "uncommon", "versatile b"], damage: { dice: 1, die: "d4", damageType: "piercing" } });
  const active = (record, types, field, context = {}) =>
    lookup(record, types, field, context).filter((mod) => mod.active && !mod.situational).map((mod) => mod.value);
  const bolka = pc({ inventory: [dagger("bolkasBlessing")] });
  assert("Bolka's blessing: +1 item to Diplomacy", active(bolka, ["skillBonus"], "diplomacy"), [1]);
  assert("and to Perception to Sense Motive", active(bolka, ["perceptionBonus"], "perception", { action: { name: "Sense Motive" } }), [1]);
  assert("not to Seek", active(bolka, ["perceptionBonus"], "perception", { action: { name: "Seek" } }), []);
  const kol = pc({ inventory: [dagger("greaterKolssOath")] });
  assert("greater Kol's oath: +2 to Society", active(kol, ["skillBonus"], "society"), [2]);
  assert("and to Diplomacy to Request", active(kol, ["skillBonus"], "diplomacy", { action: { name: "Request" } }), [2]);
  const trudd = pc({ inventory: [dagger("truddsStrength")] });
  assert("Trudd's strength: +1 to Athletics", active(trudd, ["skillBonus"], "athletics"), [1]);
  assert("and to Intimidation to Coerce", active(trudd, ["skillBonus"], "intimidation", { action: { name: "Coerce" } }), [1]);
  assert("not to Demoralize", active(trudd, ["skillBonus"], "intimidation", { action: { name: "Demoralize" } }), []);
  const stowed = pc({ inventory: [{ ...dagger("truddsStrength"), data: { ...dagger("truddsStrength").data, carried: "carried" } }] });
  assert("only while equipped", active(stowed, ["skillBonus"], "athletics"), []);

  const antimagic = pc({ inventory: [armor(["antimagic"])] });
  assert("antimagic: +1 status to saves against an arcane spell", active(antimagic, ["saveBonus"], "saving-throw", { origin: { data: { traits: ["fire", "arcane"] } } }), [1]);
  assert("not against a mundane effect", active(antimagic, ["saveBonus"], "saving-throw", { origin: { data: { traits: ["poison"] } } }), []);
  const braced = pc({ inventory: [armor(["rockBraced"])], fortitude: 10 });
  const plain = pc({ fortitude: 10 });
  const dc = (record, action) => ctx.getDefenseDCForToken(record, "fortitude", { action: { name: action } });
  assert("rock-braced: +4 to Fortitude DC against Shove", dc(braced, "Shove") - dc(plain, "Shove"), 4);
  assert("not against Grapple", dc(braced, "Grapple") - dc(plain, "Grapple"), 0);
  assert("soaring: +10 feet item bonus to fly Speed", active(pc({ inventory: [armor(["soaring"])] }), ["speedBonus"], "fly"), [10]);
}

section("Grievous");
{
  const card = (d20, metadata) => attackCard(d20, { runes: ["grievous"], weaponGroup: "sword", hasCriticalSpecialization: true, ...metadata }, 10);
  assertIncludes("a critical hit with critical specialization adds the group's benefit", card(19, {}), "**Grievous:** The target is off-guard until the end of your next turn.");
  assert("not on a hit", card(10, {}).includes("Grievous:"), false);
  assert("not without critical specialization", card(19, { hasCriticalSpecialization: false }).includes("Grievous:"), false);
  assert("not without the rune", card(19, { runes: [] }).includes("Grievous:"), false);
  assertIncludes("by group: pick", card(19, { weaponGroup: "pick" }), "increases to 4 per weapon damage die");
}

process.exitCode = summary();
