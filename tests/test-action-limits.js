// Tests for the trait-based action limits (rollhandlers/action-limits.js):
// flourish, stance, overflow, hex and composition once a turn, press only
// with a multiple attack penalty, no attacks after a finisher, spellshape
// notes on the next spell, a composition ending the one before, and a stance
// ending the other stance. Like the attack log, it warns and never blocks.
// Run: node tests/test-action-limits.js (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
// spells.js shares the sheet's scope with common.js at runtime
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// --- helpers ----------------------------------------------------------------

// Campaign variables, which every client reads at once
let variables = {};
ctx.api.getCampaignVariable = (name) => variables[name];
ctx.api.setCampaignVariable = (name, value) => {
  variables[name] = value;
};

// Token writes, applied to the record as Realm does for a linked character
let sets = [];
let record;
ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
  sets.push([id, recordType, values]);
  Object.entries(values).forEach(([path, value]) => {
    if (path.startsWith("data.") && !path.slice(5).includes(".")) record.data[path.slice(5)] = value;
  });
  if (cb) cb();
};
let notices = [];
ctx.api.showNotification = (message) => notices.push(message);

// A bard-fighter with a prepared entry for casting cantrips
const spell = (name, traits = [], extra = {}) => ({
  _id: `spell-${name}`,
  name,
  recordType: "spells",
  data: { type: "spell", level: 1, traits: ["Cantrip", ...traits], description: "", time: "1", ...extra },
  fields: {},
});
function freshCharacter() {
  return {
    _id: "pc",
    name: "Kyra",
    recordType: "characters",
    data: {
      level: 5,
      cha: 4,
      spells: [{ _id: "entry", name: "Bard Spells", data: { type: "spontaneous", tradition: "Occult", attribute: "cha", training: 1, spells1: [], cantrips: [] }, fields: {} }],
    },
    fields: {},
  };
}
const tokenFor = (rec) => ({ _id: "tok", recordType: "characters", recordId: "pc", record: rec, data: rec.data, effects: [] });
let token;

function startTurn(round = 1) {
  variables.pf2eEncounter = { round, participants: [] };
  ctx.setCurrentTurn(token, round);
  return variables.pf2eTurn.key;
}

function setup() {
  variables = {};
  sets = [];
  notices = [];
  record = freshCharacter();
  token = tokenFor(record);
  ctx.record = record;
  ctx.api.getToken = () => token;
  ctx.__state.messages = [];
}

// Uses an action or feat from the sheet; returns its chat card
function use(name, traits = []) {
  ctx.__state.messages = [];
  ctx.useAction({ name, data: { traits, description: "", actions: "oneAction" } });
  return ctx.__state.messages.join("\n");
}

// Casts a cantrip from the sheet; returns its chat card
ctx.getNearestParentDataPath = (path) => `${path}`.replace(/\.data\.[^.]+\.\d+$/, "");
ctx.api.getValueOnRecord = (target, path) => path.split(".").reduce((value, key) => value?.[key], target);
ctx.api.richTextToMarkdown = (text) => `${text || ""}`;
function cast(name, traits = []) {
  ctx.__state.messages = [];
  record.data.spells[0].data.cantrips = [spell(name, traits)];
  ctx.castSpell(record, record.data.spells[0].data.cantrips[0], "data.spells.0.data.cantrips.0");
  return ctx.__state.messages.join("\n");
}

const logged = (kind, extra = {}) => ({ id: `${Date.now()}-${Math.random()}`, kind, name: "", weaponId: null, baseItem: null, targetId: null, degree: 1, ...extra });
const actionSets = () => sets.filter(([, , values]) => values["data.turnActions"]);

// --- tests ------------------------------------------------------------------

section("Outside an encounter nothing changes");
{
  setup();
  const card = use("Double Slice", ["Flourish", "Fighter"]);
  use("Double Slice", ["Flourish", "Fighter"]);
  assert("no log written", actionSets(), []);
  assertIncludes("the card is as before", card, "#### Double Slice&nbsp;:one-action:\n\n---");
  assert("no warning", notices, []);
  const spellCard = cast("Evil Eye", ["Hex"]);
  assertNotIncludes("a spell card is as before too", spellCard, "**");
}

section("Once a turn: flourish, stance, overflow");
{
  setup();
  const key = startTurn();
  const first = use("Double Slice", ["Flourish", "Fighter"]);
  assertNotIncludes("the first flourish: no warning", first, "One flourish");
  assert("it goes in the turn's log", record.data.turnActions.uses.map((u) => [u.name, u.kind, u.traits]), [["Double Slice", "action", ["flourish"]]]);
  assert("for this turn", record.data.turnActions.turnKey, key);
  const second = use("Knockdown", ["Flourish", "Fighter"]);
  assertIncludes("the second: a warning on the card", second, "**One flourish per round:** Double Slice was already used this turn.");
  assert("and a notice", notices, ["One flourish per round: Double Slice was already used this turn."]);
  assert("it still posts and logs", record.data.turnActions.uses.length, 2);
  assertNotIncludes("other actions: no warning", use("Stride", ["Move"]), "One flourish");

  assertNotIncludes("a stance", use("Mountain Stance", ["Stance", "Monk"]), "One stance");
  assertIncludes("a second stance action this turn", use("Crane Stance", ["Stance", "Monk"]), "**One stance action per round:** Mountain Stance was already used this turn.");
  use("Base Kinesis", ["Impulse", "Overflow"]);
  assertIncludes("a second overflow impulse", use("Flying Flame", ["Impulse", "Overflow"]), "**One overflow impulse per round:** Base Kinesis was already used this turn.");

  // Next turn: a new log
  ctx.setCurrentTurn({ _id: "gob", recordType: "npcs" }, 1);
  startTurn(2);
  assertNotIncludes("the next turn: no warning", use("Double Slice", ["Flourish"]), "One flourish");
  assert("a fresh log", record.data.turnActions.uses.length, 1);
}

section("Off its turn");
{
  setup();
  ctx.setCurrentTurn({ _id: "gob", recordType: "npcs" }, 1);
  variables.pf2eEncounter = { round: 1, participants: [] };
  use("Double Slice", ["Flourish"]);
  assertNotIncludes("another creature's turn: no flourish warning", use("Double Slice", ["Flourish"]), "One flourish");
  assert("nothing logged", actionSets(), []);
  assertIncludes("press: only on your turn", use("Certain Strike", ["Press", "Fighter"]), "**Press only on your turn:**");
}

section("Press needs a multiple attack penalty");
{
  setup();
  const key = startTurn();
  assertIncludes("no attack yet: a warning", use("Certain Strike", ["Press", "Fighter"]), "**Press needs a multiple attack penalty:** there's no attack yet this turn.");
  record.data.turnAttacks = { turnKey: key, attacks: [logged("strike")] };
  assertNotIncludes("after a Strike: none", use("Certain Strike", ["Press", "Fighter"]), "Press needs");
  record.data.turnAttackSkips = { [record.data.turnAttacks.attacks[0].id]: key };
  assertIncludes("the Strike taken out of the count: warned again", use("Certain Strike", ["Press"]), "Press needs");
}

section("No attacks after a finisher");
{
  setup();
  const key = startTurn();
  use("Confident Finisher", ["Finisher", "Swashbuckler"]);
  assertIncludes("an attack-trait action after it: a warning", use("Tumble Through Strike", ["Attack"]), "**No attacks after a finisher:** Confident Finisher was used this turn.");
  assertIncludes("a second finisher too", use("Bleeding Finisher", ["Finisher"]), "No attacks after a finisher");
  assertNotIncludes("other actions are fine", use("Stride", ["Move"]), "finisher");
  const log = ctx.getOpenTurnActionLog(record, token);
  assert("the warning attack rolls get", ctx.getAfterFinisherWarning(log), "**No attacks after a finisher:** Confident Finisher was used this turn.");

  // A Strike's card shows it (attack.js prints attackNumberHint)
  const saved = { getTargets: ctx.api.getTargets, promptRoll: ctx.api.promptRoll };
  let metadata = {};
  ctx.api.getTargets = () => [];
  ctx.api.promptRoll = (name, dice, modifiers, meta) => (metadata = meta || {});
  const rapier = { _id: "rapier", name: "Rapier", recordType: "items", data: { type: "weapon", carried: "equipped", itemCategory: "martial", group: "sword", traits: ["Deadly d8", "Disarm", "Finesse"], usage: "held-in-one-hand", range: 0, damage: { dice: 1, die: "d6", damageType: "piercing" } } };
  record.data.inventory = [rapier];
  ctx.performAttackRoll(record, rapier, "data.inventory.0", 1);
  Object.assign(ctx.api, saved);
  assertIncludes("a Strike after it: the card's hint", metadata.attackNumberHint || "", "No attacks after a finisher");

  // A maneuver: skill.js prints it
  ctx.__state.messages = [];
  const savedState = { data: ctx.data };
  ctx.data = { roll: { dice: [{ type: 20, value: 12 }], total: 20, metadata: { dc: 17, rollName: "Athletics: Trip", attackNumberHint: "**No attacks after a finisher:** Confident Finisher was used this turn." } } };
  new vm.Script(`(function () {\n${fs.readFileSync(`${__dirname}/../rollhandlers/skill.js`, "utf8")}\n})();`, { filename: "skill.js" }).runInContext(ctx);
  ctx.data = savedState.data;
  assertIncludes("a maneuver's card shows it", ctx.__state.messages.join("\n"), "No attacks after a finisher");
  variables = {};
}

section("Hex and composition: one cast a turn");
{
  setup();
  startTurn();
  assertNotIncludes("the first hex: no warning", cast("Evil Eye", ["Hex", "Witch"]), "One hex");
  assert("the cast is logged as a spell", record.data.turnActions.uses.map((u) => [u.name, u.kind, u.traits]), [["Evil Eye", "spell", ["hex"]]]);
  assertIncludes("a second hex", cast("Clinging Ice", ["Hex", "Witch"]), "**One hex per turn:** Evil Eye was already used this turn.");
  assertIncludes("a second composition", (cast("Courageous Anthem", ["Composition", "Bard"]), cast("Rallying Anthem", ["Composition", "Bard"])), "**One composition per turn:** Courageous Anthem was already used this turn.");
}

section("A new composition ends the one before");
{
  setup();
  startTurn(1);
  const first = cast("Courageous Anthem", ["Composition", "Bard"]);
  assertNotIncludes("the first: nothing ends", first, "One composition at a time");
  assert("it is remembered, with its round", record.data.lastComposition, { name: "Courageous Anthem", round: 1 });
  ctx.setCurrentTurn({ _id: "gob", recordType: "npcs" }, 1);
  startTurn(2);
  assertIncludes("the next turn, a different one: the old one ends", cast("Song of Strength", ["Composition", "Bard"]), "**One composition at a time:** if Courageous Anthem is still going, it ends now.");
  ctx.setCurrentTurn({ _id: "gob", recordType: "npcs" }, 2);
  startTurn(3);
  assertNotIncludes("the same one again: nothing ends", cast("Song of Strength", ["Composition", "Bard"]), "One composition at a time");
  record.data.lastComposition = { name: "Courageous Anthem", round: 1 };
  ctx.setCurrentTurn({ _id: "gob", recordType: "npcs" }, 3);
  startTurn(6);
  assertNotIncludes("long over (5 rounds on): nothing to end", cast("Song of Strength", ["Composition", "Bard"]), "One composition at a time");
}

section("Spellshape: the next spell's card");
{
  setup();
  const key = startTurn();
  use("Reach Spell", ["Spellshape", "Concentrate"]);
  assertIncludes("right before the spell: it applies", cast("Electric Arc", ["Electricity"]), "**Spellshape:** Reach Spell applies to this spell.");
  assertNotIncludes("the spell after that: no note", cast("Electric Arc", ["Electricity"]), "Spellshape");

  use("Reach Spell", ["Spellshape"]);
  use("Stride", ["Move"]);
  assertIncludes("another action between: wasted", cast("Electric Arc"), "**Spellshape wasted:** another action came between Reach Spell and this spell.");

  use("Widen Spell", ["Spellshape"]);
  const later = Date.now() + 1000;
  record.data.turnAttacks = { turnKey: key, attacks: [logged("strike", { id: `${later}-1` })] };
  assertIncludes("a Strike between: wasted", cast("Electric Arc"), "Spellshape wasted");

  // Legacy metamagic counts the same
  setup();
  startTurn();
  use("Reach Spell", ["Metamagic", "Wizard"]);
  assertIncludes("legacy metamagic", cast("Ray of Frost"), "**Spellshape:** Reach Spell applies to this spell.");

  // The turn ending loses it: a new turn has a new log
  use("Reach Spell", ["Spellshape"]);
  ctx.setCurrentTurn({ _id: "gob", recordType: "npcs" }, 1);
  startTurn(2);
  assertNotIncludes("cast next turn: nothing", cast("Ray of Frost"), "Spellshape");
}

section("Entering a stance ends the other stance");
{
  setup();
  const removed = [];
  const added = [];
  const saved = { removeEffectById: ctx.api.removeEffectById, addEffectById: ctx.api.addEffectById };
  ctx.api.removeEffectById = (id, target, cb) => {
    removed.push(id);
    if (cb) cb();
  };
  ctx.api.addEffectById = (id) => added.push(id);
  token.effects = [
    { _id: "e-mountain", name: "Stance: Mountain Stance" },
    { _id: "e-frightened", name: "Frightened", value: 1 },
  ];
  ctx.__state.messages = [];
  ctx.applyEffectButton("fx-crane", "Stance: Crane Stance", token, undefined, 1);
  assert("the old stance goes", removed, ["e-mountain"]);
  assert("then the new one goes on", added, ["fx-crane"]);
  assertIncludes("and chat says so", ctx.__state.messages.join("\n"), "leaves Mountain Stance for Crane Stance.");

  removed.length = 0;
  added.length = 0;
  ctx.__state.messages = [];
  token.effects = [{ _id: "e-frightened", name: "Frightened", value: 1 }];
  ctx.applyEffectButton("fx-crane", "Stance: Crane Stance", token, undefined, 1);
  assert("no stance yet: nothing removed", [removed, added], [[], ["fx-crane"]]);
  assert("and nothing said", ctx.__state.messages, []);

  token.effects = [{ _id: "e-mountain", name: "Stance: Mountain Stance" }];
  ctx.applyEffectButton("fx-inspired", "Inspired", token, undefined, 1);
  assert("not a stance: the stance stays", removed, []);
  Object.assign(ctx.api, saved);
}

process.exitCode = summary() > 0 ? 1 : 0;
