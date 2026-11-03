// Tests for Delay and Ready (delay-ready.js) and the turn hooks' part in a
// delay (onTurnStart.js, onTurnEnd.js).
// Run: node tests/test-delay-ready.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const state = ctx.__state;

let sets = [];
let notes = [];
let rolls = [];
ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
  sets.push([id, values]);
  if (cb) cb();
};
ctx.api.showNotification = (text) => notes.push(text);
ctx.api.roll = (dice) => rolls.push(dice);
const reset = () => {
  sets = [];
  notes = [];
  rolls = [];
  state.messages = [];
};

// The encounter: round 2, Goblin B's turn; in the tracker Goblin A (20, delaying),
// Goblin B (15), Goblin B's minion (14.99) and Goblin C (10)
let round = 2;
const variables = {};
ctx.api.getCampaignVariable = (key) => variables[key];
ctx.api.setCampaignVariable = (key, value) => (variables[key] = value);
ctx.api.getCombatTracker = (cb) => cb({ round, tokenIds: ["a", "b", "m", "c"] });
const goblin = (id, name, initiative, data = {}) => ({ _id: id, name, recordType: "npcs", data: { initiative, ...data }, effects: [], effectIds: [] });
const a = goblin("a", "Goblin A", 20, { delaying: { round: 2, returned: false } });
const b = goblin("b", "Goblin B", 15);
const scene = [a, b, goblin("m", "Minion", 14.99), goblin("c", "Goblin C", 10)];
ctx.api.getOtherTokens = () => scene;
const turnOf = (token) => {
  variables.pf2eEncounter = { round, participants: [] };
  variables.pf2eTurn = { key: `${token._id}-key`, round, tokenId: token._id, recordId: null };
};

section("Delay");
{
  reset();
  turnOf(a);
  ctx.delayTurn({ ...a, data: { initiative: 20 } });
  assert("the delay on the token, this round", sets, [["a", { "data.delaying": { round: 2, returned: false } }]]);
  assertIncludes("the card", state.messages[0], "Goblin A Delays.** They're out of the initiative order and can't use reactions");
  assertIncludes("... with a Return button", state.messages[0], "returnFromDelay(token)");
  assert("on its own turn: no warning", notes, []);
  reset();
  turnOf(b);
  ctx.delayTurn({ ...a, data: { initiative: 20 } });
  assert("not its turn: a warning, and the GM's call", [notes.length, sets.length], [1, 1]);
  reset();
  round = 0;
  ctx.delayTurn(a);
  assert("no encounter: nothing", [sets.length, notes[0]], [0, "Delay is for an encounter's turn order."]);
  round = 2;
}

section("Return");
{
  assert("just after the creature whose turn it is", ctx.getReturnInitiative(15, [20, 14.99, 10]), 14.995);
  assert("... the last one: below it", ctx.getReturnInitiative(10, [20, 15]), 9.5);
  reset();
  turnOf(b);
  ctx.returnFromDelay(a);
  assert("after Goblin B, ahead of its minion", sets, [["a", { "data.initiative": 14.995, "data.delaying": { round: 2, returned: true } }]]);
  assertIncludes("the card", state.messages[0], "Goblin A returns** to the initiative order, acting after Goblin B.");
  reset();
  ctx.returnFromDelay(b);
  assert("not delaying: nothing", [sets.length, notes[0]], [0, "Goblin B isn't delaying."]);
  reset();
  turnOf(a);
  ctx.returnFromDelay(a);
  assert("on its own turn: nothing", [sets.length, notes[0]], [0, "Goblin A returns at the end of another creature's turn."]);
}

section("A whole round");
{
  reset();
  ctx.endFullRoundDelay(goblin("a", "Goblin A", 20, { delaying: { round: 1, returned: false } }), 2);
  assert("its turn comes round again: the delay ends", sets, [["a", { "data.delaying": null }]]);
  assertIncludes("... the actions are lost", state.messages[0], "the delayed turn's actions are lost, and their initiative stays where it was");
  reset();
  ctx.endFullRoundDelay(goblin("a", "Goblin A", 20, { delaying: { round: 2, returned: false } }), 2);
  ctx.endFullRoundDelay(goblin("a", "Goblin A", 20, { delaying: { round: 1, returned: true } }), 2);
  ctx.endFullRoundDelay(goblin("a", "Goblin A", 20), 2);
  assert("the same round, returned, or not delaying: nothing", sets, []);
}

section("A whole round: sustained spells");
{
  reset();
  const sustaining = [
    { name: "Bless", castRound: 1, sustainedRound: 2, limitRounds: 10, limitLabel: "1 minute" },
    { name: "Light", castRound: 1, sustainedRound: 1, limitRounds: 10, limitLabel: "1 minute" },
  ];
  const token = goblin("a", "Goblin A", 20, { delaying: { round: 2, returned: false }, sustaining });
  const seen = ctx.endFullRoundDelay(token, 3);
  assert("the spell not Sustained in the delay's round ends, in the same write as the delay", sets, [["a", { "data.delaying": null, "data.sustaining": [sustaining[0]] }]]);
  assertIncludes("... the card says so", state.messages[0], "**Light ends**: Goblin A didn't Sustain it this turn.");
  assert("... and the reminder sees what's left", seen.data.sustaining, [sustaining[0]]);
  reset();
  const all = goblin("a", "Goblin A", 20, { delaying: { round: 2, returned: false }, sustaining: [sustaining[0]] });
  assert("all Sustained: only the delay", [ctx.endFullRoundDelay(all, 3), sets], [all, [["a", { "data.delaying": null }]]]);
}

section("The encounter's end");
{
  reset();
  ctx.clearEncounterDelays([goblin("a", "Goblin A", 20, { delaying: { round: 3, returned: false } }), goblin("c", "Goblin C", 10)]);
  assert("a delay doesn't carry into the next encounter", sets, [["a", { "data.delaying": null }]]);
}

section("The turn's end");
{
  const end = (delaying, turnRound) => ctx.getDelayTurnEnd(goblin("a", "Goblin A", 20, delaying ? { delaying } : {}), turnRound);
  assert("not delaying: as always", end(null, 2), { repeat: true, sustain: true, clear: false });
  assert("the delayed turn: its end effects now, no sustain check", end({ round: 2, returned: false }, 2), { repeat: true, sustain: false, clear: false });
  assert("returned the same round: not again", end({ round: 2, returned: true }, 2), { repeat: false, sustain: true, clear: true });
  assert("returned the next round: that round's", end({ round: 1, returned: true }, 2), { repeat: true, sustain: true, clear: true });
}

section("The hooks");
{
  const runHook = (file, data) => {
    reset();
    ctx.data = data;
    const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
    new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  };
  const realPersistent = ctx.getTurnEndPersistentDamage;
  const realSustain = ctx.endUnsustainedSpells;
  let sustainChecks = 0;
  ctx.getTurnEndPersistentDamage = () => [{ value: "1d6 fire", partIndex: 0 }];
  ctx.endUnsustainedSpells = () => sustainChecks++;

  runHook("onTurnEnd.js", { round: 2, token: goblin("a", "Goblin A", 20, { delaying: { round: 2, returned: false } }) });
  assert("the delayed turn ends: persistent damage, no sustain check, the delay stays", [rolls, sustainChecks, sets], [["1d6 fire"], 0, []]);
  runHook("onTurnEnd.js", { round: 2, token: goblin("a", "Goblin A", 14.995, { delaying: { round: 2, returned: true } }) });
  assert("the turn it returned to ends: no persistent damage again, sustain checked, the delay cleared", [rolls, sustainChecks, sets], [[], 1, [["a", { "data.delaying": null }]]]);
  runHook("onTurnEnd.js", { round: 2, token: goblin("c", "Goblin C", 10) });
  assert("anyone else: as always", [rolls, sustainChecks, sets], [["1d6 fire"], 2, []]);

  ctx.getTurnEndPersistentDamage = realPersistent;
  ctx.endUnsustainedSpells = realSustain;

  runHook("onTurnStart.js", { round: 3, token: goblin("a", "Goblin A", 20, { delaying: { round: 2, returned: false } }) });
  assert("a turn start a round on: the delay ends", sets.some(([id, values]) => id === "a" && values["data.delaying"] === null), true);
}

section("Ready");
{
  assert("the first attack: the rules line", ctx.getReadyNote(1), "If the trigger happens before their next turn, they can use the action as a reaction. Their turn ends.");
  assertIncludes("after one attack: the 2nd attack button", ctx.getReadyNote(2), "the 2nd attack button (-5, -4 agile)");
  assertIncludes("after two: the 3rd", ctx.getReadyNote(3), "the 3rd attack button (-10, -8 agile)");
  reset();
  let prompted = null;
  ctx.api.showValuePrompt = (title, label, cb) => {
    prompted = [title, label];
    cb("Strike the first creature through the door");
  };
  turnOf(b);
  ctx.readyAction(b);
  assert("the prompt", prompted, ["Ready", "The action, and its trigger"]);
  assertIncludes("the card", state.messages[0], ":two-actions: Goblin B Readies:** Strike the first creature through the door");
}

process.exitCode = summary() > 0 ? 1 : 0;
