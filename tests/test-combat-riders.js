// Tests for the combat riders (combat-riders.js): monster Strike riders,
// "can't use again for 1d4 rounds" recharges, and Debilitating Strike.
// Run: node tests/test-combat-riders.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const state = ctx.__state;

let calls = [];
const log = (call) => calls.push(call);
ctx.api.addEffect = (name, token, duration, value) => log(["add", name, token?._id, duration, value]);
ctx.api.addEffects = (names, token) => log(["adds", names, token?._id]);
ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
  log(["set", id, values]);
  if (cb) cb();
};
ctx.api.richTextToMarkdown = (text) => `${text || ""}`;
let round = null;
ctx.api.getCombatTracker = (cb) => cb({ round });
const reset = () => {
  calls = [];
  state.messages = [];
};

function runHandler(file, data) {
  state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return state.messages.join("\n");
}

const token = (data = {}, { id = "m", name = "Giant Anaconda", recordType = "npcs" } = {}) => ({
  _id: id,
  recordType,
  name,
  identified: true,
  record: { _id: id, name },
  effects: [],
  effectIds: [],
  data,
});

section("Monster Strike riders (Q8)");
{
  assert("the module's names, as slugs; unknown ones left out", ctx.getStrikeRiders({ data: { attackEffects: ["Grab", "Push", "Swallow Whole"] } }), ["grab", "push"]);
  assert("the editor's slugs too", ctx.getStrikeRiders({ data: { attackEffects: ["improved-knockdown"] } }), ["improved-knockdown"]);
  assert("none", ctx.getStrikeRiders({ data: {} }), []);

  const meta = { strikeRiders: ["grab", "push"], targetId: "pc", targetName: "Valeros", tokenId: "m", tokenName: "Giant Anaconda" };
  const hit = ctx.getStrikeRiderLines(meta, 1).join("\n");
  assertIncludes("a hit: Grab's text", hit, "**Grab:** 1 action: the target is grabbed until the end of the monster's next turn.");
  assertIncludes("... and its button, for the target", hit, '```Apply_Grabbed\nwithManeuverToken("pc", "Valeros"');
  assertIncludes("Push: the distance", hit, "pushed 5 feet away from the monster (10 feet on a critical hit)");
  assertNotIncludes("... no button (the GM moves the token)", hit, "Apply_Push");
  assert("a miss: nothing", ctx.getStrikeRiderLines(meta, 0), []);
  assert("no DC to grade against: shown", ctx.getStrikeRiderLines({ ...meta, targetId: undefined }, null).length > 0, true);
  assertIncludes("... the button acts on the selected token", ctx.getStrikeRiderLines({ ...meta, targetId: undefined }, null).join("\n"), "api.getSelectedOrDroppedToken()");

  reset();
  ctx.applyStrikeRider(token({}, { id: "pc", name: "Valeros", recordType: "characters" }), "Grabbed", { id: "m", name: "Giant Anaconda" });
  assert("grabbed until the end of the monster's next turn, the monster as applier", calls[0], ["add", "Grabbed", "pc", { value: 2, unit: "end_applier_turn" }, { value: 1, _id: "m", name: "Giant Anaconda" }]);
  reset();
  ctx.applyStrikeRider(token({}, { id: "pc", recordType: "characters" }), "Prone", {});
  assert("prone, as the maneuvers add it", calls[0], ["adds", ["Prone"], "pc"]);

  const attack = (total, metadata) =>
    runHandler("attack.js", { roll: { dice: [{ type: 20, value: 10 }], total, metadata: { attack: "Jaws", rollName: "Attack", dc: 20, damage: "2d10+7 piercing", traits: [], ...metadata } } });
  assertIncludes("the attack card: a hit has the rider", attack(25, meta), "Apply_Grabbed");
  assertNotIncludes("... a miss doesn't", attack(12, meta), "Grab");
}

section("Recharges (Q9)");
{
  const breath = { name: "Hellfire Breath", data: { description: "Flames. The hell hound can't use Hellfire Breath again for ```1d4_Rounds\n{\napi.roll(\"1d4\")\n}\n```. If it would take fire damage, it recharges." } };
  assert("the module's text, with its 1d4 Rounds button", ctx.getRechargeFormula(breath), "1d4");
  assert("plain text", ctx.getRechargeFormula({ data: { description: "It can't use Frost Breath again for 1d6 rounds." } }), "1d6");
  assert("a fixed number", ctx.getRechargeFormula({ data: { description: "can't use this again for 2 rounds" } }), "2");
  assert("no recharge", ctx.getRechargeFormula({ data: { description: "The monster bites." } }), "");

  ctx.api.getToken = () => token({}, { id: "hh", name: "Hell Hound" });
  assertIncludes("the button on the ability's card", ctx.getRechargeButton(breath), '```Start_Recharge_(1d4_rounds)\nwithChatButtonToken("hh", "Hell Hound"');
  assertIncludes("... it starts the recharge", ctx.getRechargeButton(breath), 'startRecharge(token, "Hellfire Breath", "1d4")');
  ctx.api.getToken = () => null;

  reset();
  round = 2;
  ctx.api.rollInstant = () => ({ total: 3 });
  const hound = token({ recharges: [{ name: "Other", readyRound: 9 }] }, { id: "hh", name: "Hell Hound" });
  ctx.startRecharge(hound, "Hellfire Breath", "1d4");
  assert("in combat: 3 rounds from round 2, ready in round 5", calls[0], ["set", "hh", { "data.recharges": [{ name: "Other", readyRound: 9 }, { name: "Hellfire Breath", readyRound: 5 }] }]);
  assertIncludes("... the card says so, the round for the GM", state.messages[0], "can't use Hellfire Breath again for 3 rounds (1d4): [gm]ready at the start of its turn in round 5.[/gm]");
  reset();
  ctx.startRecharge(token({ recharges: [{ name: "Hellfire Breath", readyRound: 3 }] }, { id: "hh" }), "Hellfire Breath", "1d4");
  assert("used again: the new roll replaces the old one", calls[0][2]["data.recharges"], [{ name: "Hellfire Breath", readyRound: 5 }]);
  reset();
  round = null;
  ctx.startRecharge(hound, "Hellfire Breath", "1d4");
  assert("out of combat: only the card", [calls.length, state.messages.length], [0, 1]);

  const waiting = token({ recharges: [{ name: "Hellfire Breath", readyRound: 5 }, { name: "Tail Sweep", readyRound: 7 }] }, { id: "hh", name: "Hell Hound" });
  assert("before round 5: not ready", ctx.getReadyRecharges(waiting, 4), null);
  assert("round 5: ready, the other left", ctx.getReadyRecharges(waiting, 5), { ready: ["Hellfire Breath"], left: [{ name: "Tail Sweep", readyRound: 7 }] });
  reset();
  ctx.runTurnStartRecharges(waiting, 6);
  assert("turn start: the ready one comes off", calls[0], ["set", "hh", { "data.recharges": [{ name: "Tail Sweep", readyRound: 7 }] }]);
  assertIncludes("... and the GM is told", state.messages[0], "[gm]Hell Hound can use Hellfire Breath again.[/gm]");
  reset();
  ctx.runTurnStartRecharges(token({ recharges: [] }, { id: "hh" }), 6);
  assert("nothing waiting: no write", calls, []);
}

section("Debilitating Strike (Q24)");
{
  const toggle = (on) => ({ data: { toggled: on, predicateValue: "debilitation" } });
  const rogue = (on, feats = []) => ({ recordType: "characters", data: { toggles: [toggle(on)], feats } });
  assert("toggle off: none", ctx.getDebilitationCount(rogue(false)), 0);
  assert("toggle on: one", ctx.getDebilitationCount(rogue(true)), 1);
  assert("with Double Debilitation: two", ctx.getDebilitationCount({ recordType: "characters", data: { toggles: [toggle(true)], classes: [{ data: { features: [{ name: "Double Debilitation" }] } }] } }), 2);

  const meta = { debilitation: 1, isOffGuard: true, targetId: "orc", targetName: "Orc", tokenId: "rogue", tokenName: "Merisiel" };
  const lines = ctx.getDebilitationLines(meta, 1).join("\n");
  assertIncludes("a hit on an off-guard target: the debilitations", lines, "**Debilitating Strike** (free action, until the end of your next turn): one debilitation");
  assertIncludes("... the Speed penalty", lines, "-10-foot status penalty to its Speeds");
  assertIncludes("... and a button for enfeebled 1", lines, "```Apply_Enfeebled_1");
  assertIncludes("Double Debilitation: two", ctx.getDebilitationLines({ ...meta, debilitation: 2 }, 2).join("\n"), "two debilitations");
  assert("not off-guard: nothing", ctx.getDebilitationLines({ ...meta, isOffGuard: false }, 1), []);
  assert("a miss: nothing", ctx.getDebilitationLines(meta, 0), []);
  assert("toggle off: nothing", ctx.getDebilitationLines({ ...meta, debilitation: 0 }, 1), []);

  reset();
  ctx.applyDebilitation(token({}, { id: "orc", name: "Orc" }), "Enfeebled", { id: "rogue", name: "Merisiel" });
  assert("enfeebled until the end of the rogue's next turn", calls[0], ["add", "Enfeebled", "orc", { value: 2, unit: "end_applier_turn" }, { value: 1, _id: "rogue", name: "Merisiel" }]);
}

summary();
