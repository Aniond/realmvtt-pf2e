// Tests for cover from creatures in the way (rollhandlers/cover.js): a line
// between the attacker's and the target's centers that passes through a
// creature gives lesser cover (+1 AC), or standard cover (+2) behind a
// creature two sizes larger than both. Strike and spell attack prompts get it
// as an unticked modifier, which doesn't stack with circumstance bonuses the
// target already has.
// Run: node tests/test-cover.js (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// A token at a grid position (2D: a medium token's position is its center)
const creature = (id, x, y, { size = "medium", conditions = [], recordType = "npcs" } = {}) => {
  const effects = conditions.map((name, i) => ({ _id: `${id}-fx-${i}`, name: name[0].toUpperCase() + name.slice(1) }));
  return {
    _id: id,
    name: id,
    recordType,
    position: { x, y },
    effects,
    effectIds: effects.map((e) => e._id),
    record: { name: id, recordType },
    data: { ac: 18, level: 3, size, traits: [] },
  };
};
const cover = (target, attacker, others) => ctx.getCreatureCoverModifiers(target, attacker, others, { attackRange: "ranged" });

section("Creatures in the way");
{
  const archer = creature("Archer", 0, 0);
  const orc = creature("Orc", 4, 0);
  const goblin = creature("Goblin", 2, 0);
  assert("a creature on the line: lesser cover", cover(orc, archer, [archer, orc, goblin]), [
    { name: "Target AC +1 (Lesser Cover: Goblin in the way)", type: "", value: -1, active: false, isPenalty: true },
  ]);
  assert("nobody in the way: none", cover(orc, archer, [archer, orc, creature("Goblin", 2, 2)]), []);
  assert("the attacker and the target aren't in their own way", cover(goblin, archer, [archer, goblin]), []);
  // The line from (0,0) to (2,2) only touches the corner of (1,0)'s square
  assert("a line through a corner: none", cover(creature("Orc", 2, 2), archer, [creature("Goblin", 1, 0)]), []);
  assert("a line through the middle of a diagonal: cover", cover(creature("Orc", 2, 2), archer, [creature("Goblin", 1, 1)]).length, 1);
  assert("a dead creature: none", cover(orc, archer, [creature("Goblin", 2, 0, { conditions: ["dead"] })]), []);
  assert("a hazard: none", cover(orc, archer, [creature("Trap", 2, 0, { recordType: "hazards" })]), []);
  assert("hidden from the players: none", cover(orc, archer, [{ ...goblin, visible: false }]), []);
  // A huge snake whose space overlaps the target's: the line only crosses it
  // inside the target's own space
  assert(
    "overlapping the target: not between them",
    cover(creature("Dragon", 4, 0), archer, [creature("Snake", 5, -1, { size: "huge" })]),
    [],
  );
  assert(
    "several: named once each",
    cover(creature("Orc", 6, 0), archer, [goblin, creature("Goblin", 4, 0), creature("Wolf", 3, 0)])[0].name,
    "Target AC +1 (Lesser Cover: Goblin, Wolf in the way)",
  );
}

section("Large creatures: standard cover");
{
  const archer = creature("Archer", 0, 0);
  const orc = creature("Orc", 6, 0);
  // A huge creature's 3x3 space: its position is its center
  const giant = creature("Giant", 3, 1, { size: "huge" });
  assert("two sizes larger than both: standard cover", cover(orc, archer, [giant])[0].name, "Target AC +2 (Standard Cover: Giant in the way)");
  assert("only one size larger than the target: lesser", cover(creature("Ogre", 6, 0, { size: "large" }), archer, [giant])[0].value, -1);
  assert("a large creature between mediums: lesser", cover(orc, archer, [creature("Bear", 3, 0, { size: "large" })])[0].value, -1);
}

section("Doesn't stack with the target's circumstance bonuses");
{
  const archer = creature("Archer", 0, 0);
  const orc = creature("Orc", 4, 0);
  const goblin = creature("Goblin", 2, 0);
  const realShield = ctx.getRaisedShieldAcBonus;
  ctx.getRaisedShieldAcBonus = () => 2;
  assert("behind a raised shield's +2: none", cover(orc, archer, [goblin]), []);
  assert("standard cover behind it: none either", cover(orc, archer, [creature("Giant", 2, 1, { size: "huge" })]), []);
  ctx.getRaisedShieldAcBonus = () => 1;
  assert("standard cover over a +1: the difference", cover(orc, archer, [creature("Giant", 2, 1, { size: "huge" })])[0].name, "Target AC +1 (Standard Cover: Giant in the way)");
  ctx.getRaisedShieldAcBonus = realShield;
}

section("In the roll prompts");
{
  const shooter = {
    _id: "pc",
    recordType: "characters",
    name: "Kyra",
    effects: [],
    effectIds: [],
    fields: {},
    data: {
      level: 5, str: 1, dex: 4, size: "medium", ancestries: [{ name: "Human", data: { speed: "25 feet", hp: 8 } }],
      classes: [{ name: "Fighter", data: { hp: 10, features: [] } }], feats: [], bonusFeats: [],
      inventory: [{ _id: "w-javelin", name: "Javelin", recordType: "items", data: { type: "weapon", carried: "equipped", itemCategory: "simple", group: "dart", traits: ["Thrown-30"], usage: "held-in-one-hand", range: 30, ammo: 3, damage: { dice: 1, die: "d6", damageType: "piercing" }, runes: { potency: 0, striking: 0, property: [] } } }],
    },
  };
  const token = { _id: "tok", recordType: "characters", recordId: "pc", name: "Kyra", record: shooter, data: shooter.data, effects: [], effectIds: [], position: { x: 0, y: 0 } };
  const orc = creature("Orc", 4, 0);
  const goblin = creature("Goblin", 2, 0);
  const prompted = (run) => {
    const saved = { ...ctx.api };
    let captured = null;
    ctx.api.getTargets = () => [{ token: orc, distance: 20 }];
    ctx.api.getToken = () => token;
    ctx.api.getOtherTokens = () => [token, orc, goblin];
    ctx.api.getRecord = (type, id, cb) => cb(shooter);
    ctx.api.promptRoll = (name, dice, modifiers) => {
      captured = modifiers;
    };
    try {
      run();
    } finally {
      Object.assign(ctx.api, saved);
    }
    return (captured || []).filter((m) => m.name.includes("Cover")).map((m) => `${m.name} ${m.value} ${m.active}`);
  };
  assert(
    "a Strike: offered unticked",
    prompted(() => ctx.performAttackRoll(shooter, shooter.data.inventory[0], "data.inventory.0", 1)),
    ["Target AC +1 (Lesser Cover: Goblin in the way) -1 false"],
  );

  const ray = { name: "Ray", data: { defense: { passive: { statistic: "ac" } }, traits: [], damage: [] } };
  const entry = { data: { dc: 20, attribute: "cha", attack: 10 } };
  const castRay = () => {
    const macro = ctx.getSpellAttackMacro(shooter, ray, entry, "data.spells.0", null);
    const body = String(macro).replace(/^```Roll_Attack\n/, "").replace(/```\s*$/, "");
    const getValue = ctx.api.getValueOnRecord;
    ctx.api.getValueOnRecord = (r, path) => (path === "data.spells.0" ? ray : getValue(r, path));
    new vm.Script(body, { filename: "spell-attack-macro.js" }).runInContext(ctx);
  };
  assert("a spell attack: offered unticked", prompted(castRay), ["Target AC +1 (Lesser Cover: Goblin in the way) -1 false"]);
}

summary();
