// Tests for concealment and detection (rollhandlers/concealment.js): the
// flat check to target a concealed (DC 5) or hidden, invisible or
// undetected (DC 11) creature, or from a dazzled (DC 5) or blinded (DC 11)
// attacker, shown on the attack card as a button; and an unseen attacker
// making its target off-guard. Nothing is rolled or refused for the GM.
// Run: node tests/test-concealment.js (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// A token with conditions (effects by name)
const creature = (id, conditions = []) => {
  const effects = conditions.map((name, i) => ({ _id: `${id}-fx-${i}`, name: name[0].toUpperCase() + name.slice(1) }));
  return { _id: id, name: id, recordType: "npcs", effects, effectIds: effects.map((e) => e._id), record: { name: id }, data: { ac: 18, level: 3, traits: [] } };
};

function pc(conditions = []) {
  const effects = conditions.map((name, i) => ({ _id: `pc-fx-${i}`, name: name[0].toUpperCase() + name.slice(1) }));
  return {
    _id: "pc",
    recordType: "characters",
    name: "Merisiel",
    effects,
    effectIds: effects.map((e) => e._id),
    fields: {},
    data: {
      level: 5, str: 1, dex: 4, ancestries: [{ name: "Elf", data: { speed: "30 feet", hp: 6 } }],
      classes: [{ name: "Rogue", data: { hp: 8, features: [] } }], feats: [], bonusFeats: [],
      inventory: [{ _id: "w-rapier", name: "Rapier", recordType: "items", data: { type: "weapon", carried: "equipped", itemCategory: "martial", group: "sword", traits: ["Finesse"], usage: "held-in-one-hand", range: 0, damage: { dice: 1, die: "d6", damageType: "piercing" }, runes: { potency: 0, striking: 0, property: [] } } }],
    },
  };
}
const tokenOf = (record) => ({ _id: "tok", recordType: "characters", recordId: "pc", name: record.name, record, data: record.data, effects: record.effects, effectIds: record.effectIds });

function strike(record, targets) {
  const saved = { getTargets: ctx.api.getTargets, getToken: ctx.api.getToken, promptRoll: ctx.api.promptRoll };
  const prompts = [];
  ctx.api.getTargets = () => targets.map((token) => ({ token, distance: 5 }));
  ctx.api.getToken = () => tokenOf(record);
  ctx.api.promptRoll = (name, dice, modifiers, metadata) => prompts.push(metadata || {});
  try {
    ctx.performAttackRoll(record, record.data.inventory[0], "data.inventory.0", 1);
  } finally {
    Object.assign(ctx.api, saved);
  }
  return prompts;
}

function runHandler(file, data) {
  ctx.__state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return ctx.__state.messages.join("\n");
}

// --- tests ------------------------------------------------------------------

section("Which flat check (Player Core pg. 442-447)");
{
  const me = creature("me");
  assert("nothing: none", ctx.getConcealmentFlatCheck(me, creature("orc")), null);
  assert("a concealed target: DC 5", ctx.getConcealmentFlatCheck(me, creature("orc", ["concealed"])), { dc: 5, reason: "orc is concealed" });
  assert("hidden: DC 11", ctx.getConcealmentFlatCheck(me, creature("orc", ["hidden"])).dc, 11);
  assert("invisible: DC 11", ctx.getConcealmentFlatCheck(me, creature("orc", ["invisible"])).dc, 11);
  assert("undetected: DC 11", ctx.getConcealmentFlatCheck(me, creature("orc", ["undetected"])).dc, 11);
  assert("a dazzled attacker: DC 5", ctx.getConcealmentFlatCheck(creature("me", ["dazzled"]), creature("orc")), { dc: 5, reason: "me is dazzled" });
  assert("a blinded attacker: DC 11", ctx.getConcealmentFlatCheck(creature("me", ["blinded"]), creature("orc")).dc, 11);
  assert("the worst one", ctx.getConcealmentFlatCheck(creature("me", ["dazzled"]), creature("orc", ["hidden"])), { dc: 11, reason: "orc is hidden" });

  assert("a hidden attacker is unseen", ctx.isUnseenAttacker(creature("me", ["hidden"])), true);
  assert("invisible too", ctx.isUnseenAttacker(creature("me", ["invisible"])), true);
  assert("concealed isn't", ctx.isUnseenAttacker(creature("me", ["concealed"])), false);
}

section("A Strike: the flat check on the card, off-guard from an unseen attacker");
{
  const plain = strike(pc(), [creature("orc")]);
  assert("an ordinary target: no flat check", plain[0].concealment, null);
  const concealed = strike(pc(), [creature("orc", ["concealed"])]);
  assert("a concealed target: DC 5 in the roll", concealed[0].concealment, { dc: 5, reason: "orc is concealed" });
  const unseen = strike(pc(["hidden"]), [creature("orc")]);
  assert("a hidden attacker: the target's AC is 2 lower (off-guard)", [plain[0].dc - unseen[0].dc], [2]);

  const card = runHandler("attack.js", { roll: { dice: [{ type: 20, value: 15 }], total: 25, metadata: { dc: 18, attack: "Rapier", traits: [], damage: "1d6 piercing", concealment: { dc: 11, reason: "orc is hidden" } } } });
  assertIncludes("the card says so", card, "**Flat check DC 11:** orc is hidden; on a failure the attack misses.");
  assertIncludes("with a button, not a roll", card, "```Flat_Check_DC11\napi.promptRoll(\"Flat Check (DC 11)\", \"1d20\", [], { rollName: \"Flat Check\", dc: 11 }, \"flatCheck\");");
  assertNotIncludes("no flat check: nothing", runHandler("attack.js", { roll: { dice: [{ type: 20, value: 15 }], total: 25, metadata: { dc: 18, attack: "Rapier", traits: [], damage: "1d6 piercing" } } }), "Flat check");
}

process.exitCode = summary() > 0 ? 1 : 0;
