// Tests for animal companions as characters (rollhandlers/animal-companions.js
// and its hooks in common.js, roadmap H14 phase 1): the Animal Companion
// class (no ABP, no Level Up boosts, item bonuses only to AC and Speed, AC
// item bonus at most +3), the weaponDiceCount modifier, creatureSize "+1",
// attributeBonus values as numbers, and the master's level.
// Run: node tests/test-animal-companions.js (or via tests/run-all.js)

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();

let nextId = 0;
const id = () => `t-${++nextId}`;

// The module's Animal Companion class (Foundry's): 6 HP a level, trained in
// Perception, saves, unarmed attacks, unarmored defense, Acrobatics and
// Athletics, no feat or skill-increase levels
const COMPANION_CLASS = {
  _id: "class-ac",
  name: "Animal Companion",
  recordType: "class",
  data: {
    hp: 6,
    perception: "1",
    savingThrows: { fortitude: "1", reflex: "1", will: "1" },
    attacks: { unarmed: "1", simple: "0", martial: "0", advanced: "0" },
    defenses: { unarmored: "1", light: "0", medium: "0", heavy: "0" },
    trainedSkills: ["Acrobatics", "Athletics"],
    ancestryFeatLevels: [],
    classFeatLevels: [],
    generalFeatLevels: [],
    skillFeatLevels: [],
    skillIncreaseLevels: [],
    features: [],
  },
};
const FIGHTER = { _id: "class-f", name: "Fighter", recordType: "class", data: { hp: 10, features: [] } };

const modifier = (data) => ({ _id: id(), recordType: "records", data: { modifierType: "none", valueType: "number", active: true, field: "", ...data } });
const feat = (name, modifiers = []) => ({ _id: id(), name, recordType: "feats", data: { level: 1, modifiers: modifiers.map(modifier) } });
// A bear's ancestry: size and HP, and a feature with its attribute modifiers
const bearAncestry = (size = "small") => ({
  _id: "anc-bear",
  name: "Bear",
  recordType: "ancestry",
  data: {
    hp: 8,
    size,
    speed: "35 feet",
    features: [
      {
        _id: "bear-feature",
        name: "Bear",
        data: {
          level: 1,
          modifiers: [
            ["str", "3"],
            ["dex", "2"],
            ["con", "2"],
            ["wis", "1"],
          ].map(([field, value]) => modifier({ type: "attributeBonus", field, valueType: "number", value })),
        },
      },
    ],
  },
});

function character({ classObj = COMPANION_CLASS, ancestry = bearAncestry(), feats = [], ...data } = {}) {
  return {
    _id: id(),
    recordType: "characters",
    name: "Bruno",
    effects: [],
    effectIds: [],
    data: { level: 1, classes: [classObj], ancestries: [ancestry], heritages: [], feats, bonusFeats: [], features: [], inventory: [], ...data },
    fields: {},
  };
}
const fighter = (extra = {}) => character({ classObj: FIGHTER, ancestry: { name: "Human", data: { hp: 8, size: "medium", speed: "25 feet" } }, ...extra });

// What onAddEditFeature writes for a record
function recalc(record) {
  const saved = ctx.api.setValuesOnRecord;
  const written = {};
  ctx.api.setValuesOnRecord = (rec, values) => Object.assign(written, values);
  try {
    ctx.onAddEditFeature(record, undefined, true);
  } finally {
    ctx.api.setValuesOnRecord = saved;
  }
  return written;
}

section("Which characters are animal companions");
{
  assert("class Animal Companion", ctx.isAnimalCompanionCharacter(character()), true);
  assert("a class record flagged animalCompanion", ctx.isAnimalCompanionCharacter(character({ classObj: { name: "Bond Beast", data: { animalCompanion: true } } })), true);
  assert("a fighter isn't", ctx.isAnimalCompanionCharacter(fighter()), false);
  assert("a token's record counts", ctx.isAnimalCompanionCharacter({ record: character() }), true);
  // Dropping one of these ancestries asks for no heritage
  assert("a companion ancestry, flagged", ctx.isAnimalCompanionAncestry({ data: { animalCompanion: true, traits: [] } }), true);
  assert("an animal ancestry (the records loaded before the flag)", ctx.isAnimalCompanionAncestry({ data: { traits: ["Animal"] } }), true);
  assert("a playable ancestry isn't", ctx.isAnimalCompanionAncestry({ data: { traits: ["Uncommon", "Humanoid", "Kobold"] } }), false);

  // ... and gives a new companion its type's picture
  const bearType = { portrait: "/icons/fantasy/spells/animal-form-bear.webp", data: { animalCompanion: true, traits: ["Animal"] } };
  assert(
    "a new companion takes its type's portrait and token image",
    ctx.getCompanionImageValues({ portrait: "", token: {} }, bearType),
    { portrait: bearType.portrait, "token.imageUrl": bearType.portrait },
  );
  assert(
    "a placeholder portrait is replaced, a token image of its own kept",
    ctx.getCompanionImageValues({ portrait: "/icons/fantasy/default-icons/character.svg", token: { imageUrl: "/images/my-bear.webp" } }, bearType),
    { portrait: bearType.portrait },
  );
  assert("its own portrait and token are kept", ctx.getCompanionImageValues({ portrait: "/images/bruno.webp", token: { imageUrl: "/images/bruno-token.webp" } }, bearType), {});
  assert("a playable ancestry changes no picture", ctx.getCompanionImageValues({ portrait: "" }, { portrait: "/icons/x.webp", data: { traits: ["Humanoid"] } }), {});
  assert("a companion type without a real picture changes nothing", ctx.getCompanionImageValues({ portrait: "" }, { portrait: "/icons/fantasy/default-icons/npc.svg", data: { animalCompanion: true } }), {});
}

section("No Automatic Bonus Progression, no attribute boosts at Level Up");
{
  const abp = { automaticBonusProgression: true };
  assert("ABP on: a fighter has it", ctx.isAbpCharacter(fighter(), abp), true);
  assert("... an animal companion doesn't", ctx.isAbpCharacter(character(), abp), false);
  assert("Level Up to 5th: a fighter's 4 boosts", ctx.getLevelUpGains(fighter({ level: 4 }), 5, {}).boostCount, 4);
  assert("... an animal companion's none", ctx.getLevelUpGains(character({ level: 4 }), 5, {}).boostCount, 0);
}

section("Item bonuses: only to AC and Speed (Player Core pg. 206)");
{
  const collar = feat("Gear", [
    { type: "skillBonus", field: "athletics", modifierType: "item", value: "2" },
    { type: "armorClassBonus", field: "", modifierType: "item", value: "1" },
    { type: "speedBonus", field: "", modifierType: "item", value: "5" },
    { type: "skillPenalty", field: "athletics", modifierType: "item", value: "1" },
    { type: "skillBonus", field: "athletics", modifierType: "status", value: "1" },
  ]);
  const kinds = (record, types) =>
    ctx.getEffectsAndModifiersForToken(record, types, "", undefined, undefined, { keepEveryModifier: true }).map((m) => `${m.type}:${m.modifierType}:${m.value}`).sort();
  const types = ["skillBonus", "skillPenalty", "armorClassBonus", "speedBonus"];
  assert(
    "a companion: no item bonus to Athletics; AC, Speed, the penalty and status stay",
    kinds(character({ feats: [collar] }), types),
    ["item:armorClassBonus:1", "item:skillPenalty:-1", "item:speedBonus:5", "status:skillBonus:1"],
  );
  assert("a fighter keeps them all", kinds(fighter({ feats: [collar] }), types).length, 5);

  const barding = { _id: "bard", name: "Heavy Barding", data: { type: "armor", acBonus: 2, runes: { potency: 2 }, invested: "true" } };
  assert("barding +2 with a +2 rune: +3 at most for a companion", ctx.getACForArmor(barding, character()), 3);
  assert("... +4 for a fighter", ctx.getACForArmor(barding, fighter()), 4);
  assert("a small bonus is kept as it is", ctx.getACForArmor({ data: { acBonus: 1 } }, character()), 1);
}

section("Weapon Damage Dice (weaponDiceCount): a mature companion's 2 dice, a specialized one's 3");
{
  const jaws = { _id: "jaws", name: "Jaws", data: { type: "weapon", itemCategory: "Unarmed", traits: ["Unarmed"], damage: { dice: 1, die: "d8", damageType: "piercing" } } };
  const sword = { _id: "sword", name: "Longsword", data: { type: "weapon", itemCategory: "Martial", traits: [], damage: { dice: 1, die: "d8", damageType: "slashing" } } };
  const dice = (count) => ({ type: "weaponDiceCount", value: String(count), predicate: '["item:category:unarmed"]' });
  const mature = character({ feats: [feat("Mature Animal Companion", [dice(2)])] });
  assert("mature: jaws 2d8", ctx.getAlteredWeapon(mature, jaws).data.damage.dice, 2);
  assert("... the predicate keeps it to unarmed attacks", ctx.getAlteredWeapon(mature, sword).data.damage.dice, 1);
  const specialized = character({ feats: [feat("Mature Animal Companion", [dice(2)]), feat("Specialized Animal Companion", [dice(3)])] });
  assert("specialized: the highest, 3", ctx.getAlteredWeapon(specialized, jaws).data.damage.dice, 3);
  assert("a weapon with more dice keeps them", ctx.getAlteredWeapon(mature, { ...jaws, data: { ...jaws.data, damage: { ...jaws.data.damage, dice: 3 } } }).data.damage.dice, 3);
  assert("the weapon itself isn't changed", jaws.data.damage.dice, 1);
  assert("without one: as it was", ctx.getAlteredWeapon(character(), jaws).data.damage.dice, 1);
  assert("striking still adds to the count", ctx.getWeaponDiceCount({ data: { damage: { dice: 2 }, runes: { striking: 1 } } }), 3);
}

section('Creature size "+1": grows one size, up to Large');
{
  const grow = feat("Mature Animal Companion", [{ type: "creatureSize", valueType: "string", value: "+1" }]);
  const savage = feat("Savage Animal Companion", [{ type: "creatureSize", valueType: "string", value: "+1" }]);
  assert("a Small bear, mature: Medium", recalc(character({ size: "small", feats: [grow] }))["data.size"], "medium");
  assert("... and savage: Large", recalc(character({ size: "small", feats: [grow, savage] }))["data.size"], "large");
  assert("a Medium horse, mature and savage: Large, no bigger", recalc(character({ size: "medium", ancestry: bearAncestry("medium"), feats: [grow, savage] }))["data.size"], "large");
  assert("a Large drake stays Large", recalc(character({ size: "large", ancestry: bearAncestry("large"), feats: [grow] }))["data.size"], undefined);
  assert("a fixed size still works (Ant Kholo)", recalc(character({ size: "medium", feats: [feat("Ant", [{ type: "creatureSize", valueType: "string", value: "small" }])] }))["data.size"], "small");
}

section("Attribute modifiers from the ancestry (attributeBonus)");
{
  const written = recalc(character());
  assert("the bear's Str +3, Dex +2, Con +2, Wis +1 (no boosts)", [written["data.strMod"], written["data.dexMod"], written["data.conMod"], written["data.wisMod"]], [3, 2, 2, 1]);
  const text = character({ feats: [feat("Bully", [{ type: "attributeBonus", field: "cha", valueType: "string", value: "3" }])] });
  assert("a value kept as text adds as a number", recalc(text)["data.chaMod"], 3);
  const off = character({ feats: [feat("Off", [{ type: "attributeBonus", field: "int", value: "2", active: false }])] });
  assert("an inactive one adds nothing", recalc(off)["data.intMod"] ?? 0, 0);
}

section("The Notes tab's companion box");
{
  assert("shown for an animal companion", recalc(character())["fields.companionProperties.hidden"], false);
  assert("hidden for anyone else", recalc(fighter())["fields.companionProperties.hidden"], true);
  assert("nothing written when already right", "fields.companionProperties.hidden" in recalc({ ...character(), fields: { companionProperties: { hidden: false } } }), false);
}

section("The companion's level is its master's");
{
  const master = { _id: "pc-kyra", recordType: "characters", data: { level: 5 } };
  const writes = [];
  let recalcs = 0;
  ctx.api.getRecord = (type, rid, cb) => cb(rid === "pc-kyra" ? master : null);
  ctx.api.setValuesOnRecord = (rec, values, cb) => {
    writes.push(values);
    if (cb) cb({ ...rec, data: { ...rec.data, level: values["data.level"] } });
  };
  const savedRecalc = ctx.onAddEditFeature;
  ctx.onAddEditFeature = () => (recalcs += 1);
  const bruno = character({ level: 1, companionMaster: JSON.stringify({ _id: "pc-kyra", name: "Kyra" }) });
  assert("the master's id from the Master field", ctx.getCompanionMasterId(bruno), "pc-kyra");
  let after = null;
  ctx.syncCompanionLevel(bruno, undefined, (r) => (after = r));
  assert("level 5 written, then the sheet worked out again", [writes, recalcs, after.data.level], [[{ "data.level": 5 }], 1, 5]);
  writes.length = 0;
  ctx.syncCompanionLevel({ ...bruno, data: { ...bruno.data, level: 5 } });
  assert("already the master's level: nothing written", writes.length, 0);
  ctx.syncCompanionLevel(character({ level: 1 }));
  assert("no master: nothing", writes.length, 0);

  // The Master field's onchange uses its new value, not the stale record
  const notices = [];
  ctx.api.showNotification = (message) => notices.push(message);
  ctx.record = character({ level: 1 });
  ctx.onCompanionMasterChange(JSON.stringify({ _id: "pc-kyra", name: "Kyra" }));
  assert("choosing the master sets the level", writes[0], { "data.level": 5 });
  assert("and says so", notices[0], "Bruno is now level 5, as its master is.");
  ctx.onAddEditFeature = savedRecalc;
  ctx.record = { data: {}, fields: {}, type: "characters", _id: "test" };
}

process.exitCode = summary() > 0 ? 1 : 0;
