// Tests for condition upkeep in the turn hooks (frightened, stunned, slowed,
// quickened) and the effects that end with an encounter.

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const state = ctx.__state;

let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;

// Effect API calls the hooks make. Callbacks run right away, so a chain of
// calls shows up in order.
let calls = [];
ctx.api.deductEffectById = (effectId, token, cb) => {
  calls.push(["deduct", effectId, token?._id]);
  if (cb) cb();
};
ctx.api.removeEffectById = (effectId, token, cb) => {
  calls.push(["remove", effectId, token?._id]);
  if (cb) cb();
};
ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
  calls.push(["set", id, values]);
  if (cb) cb();
};

// The combat tracker's round the turn-start upkeep reads
let combatRound = 1;
ctx.api.getCombatTracker = (cb) => cb({ round: combatRound });

// Runs a hook file the way the combat tracker does, with `data` in scope
function runHook(file, data) {
  calls = [];
  state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(
    ctx,
  );
}

// An effect as the module has it (the conditions are indefinite)
const effect = (name, duration = 0, durationUnit = "indefinite", _id = name) => ({
  _id,
  name,
  duration,
  durationUnit,
  stackable: false,
  rules: [],
});
const FRIGHTENED = { ...effect("Frightened", 0, "indefinite", "frightened"), stackable: true };
const STUNNED = { ...effect("Stunned", 0, "indefinite", "stunned"), stackable: true };
const SLOWED = { ...effect("Slowed", 0, "indefinite", "slowed"), stackable: true };
const QUICKENED = effect("Quickened", 0, "indefinite", "quickened");
const DEAD = effect("Dead", 0, "indefinite", "dead");

// A token with conditions: [[effect, value], ...]. A stackable condition is one
// effect whose _id is in effectIds once per stack.
function tokenWith(conditions, extra = {}) {
  const effects = [];
  const effectIds = [];
  for (const [effect, value = 1] of conditions) {
    effects.push(effect);
    for (let i = 0; i < value; i++) effectIds.push(effect._id);
  }
  return {
    _id: "tok",
    name: "Valeros",
    recordType: "npcs",
    data: {},
    effects,
    effectIds,
    effectValues: {},
    ...extra,
  };
}

const actions = (conditions, extra) => ctx.getTurnStartActions(tokenWith(conditions, extra));

section("isConditionUpkeepOn");
{
  settings = {};
  assert("on when the campaign has no value yet", ctx.isConditionUpkeepOn(), true);
  settings = { conditionUpkeep: "yes" };
  assert("on with yes", ctx.isConditionUpkeepOn(), true);
  settings = { conditionUpkeep: "no" };
  assert("off with no", ctx.isConditionUpkeepOn(), false);
  const getSetting = ctx.api.getSetting;
  ctx.api.getSetting = () => {
    throw new Error("no settings");
  };
  assert("on when settings can't be read", ctx.isConditionUpkeepOn(), true);
  ctx.api.getSetting = getSetting;
  settings = {};
}

section("getTokenCondition");
{
  const token = tokenWith([[FRIGHTENED, 3]]);
  assert("value is the number of stacks", ctx.getTokenCondition(token, "frightened").value, 3);
  assert("name match ignores case", ctx.getTokenCondition(token, "FRIGHTENED").effect._id, "frightened");
  assert("missing condition", ctx.getTokenCondition(token, "slowed"), null);
  const other = { ...FRIGHTENED, _id: "frightened-2" };
  const two = tokenWith([[FRIGHTENED, 1], [other, 2]]);
  assert("two of the same name: the higher value", ctx.getTokenCondition(two, "Frightened").effect._id, "frightened-2");
}

section("getTurnStartActions: printed examples (Player Core pg. 446)");
{
  let r = actions([[STUNNED, 4]]);
  assert("stunned 4: no actions", r.actions, 0);
  assert("stunned 4: takes 3 stacks off", r.stunnedDeduct, 3);
  assert("stunned 4: does not end", r.stunnedEnds, false);
  r = actions([[STUNNED, 1]]);
  assert("stunned 1 next turn: 2 actions", r.actions, 2);
  assert("stunned 1: takes its last stack", r.stunnedDeduct, 1);
  assert("stunned 1: ends", r.stunnedEnds, true);
  r = actions([[STUNNED, 1], [SLOWED, 2]]);
  assert("stunned 1 and slowed 2: 1 action", r.actions, 1);
  assert("stunned 1 and slowed 2: stunned ends", r.stunnedDeduct, 1);
}

section("getTurnStartActions");
{
  let r = actions([]);
  assert("no conditions: 3 actions", r.actions, 3);
  assert("no conditions: nothing changed", r.changed, false);
  assert("no conditions: no stunned to deduct", r.stunnedDeduct, 0);
  assert("quickened: 4 actions", actions([[QUICKENED]]).actions, 4);
  assert("slowed 1: 2 actions", actions([[SLOWED, 1]]).actions, 2);
  assert("slowed 3: no actions", actions([[SLOWED, 3]]).actions, 0);
  assert("slowed 4: still no actions", actions([[SLOWED, 4]]).actions, 0);
  assert("quickened and slowed 1: 3 actions", actions([[QUICKENED], [SLOWED, 1]]).actions, 3);
  assert("quickened and slowed 1: still reported", actions([[QUICKENED], [SLOWED, 1]]).changed, true);

  r = actions([[STUNNED, 2], [SLOWED, 1]]);
  assert("stunned 2 and slowed 1: 1 action", r.actions, 1);
  assert("stunned 2 and slowed 1: takes 2 stunned", r.stunnedDeduct, 2);

  r = actions([[STUNNED, 2], [QUICKENED]]);
  assert("quickened and stunned 2: 2 actions", r.actions, 2);
  r = actions([[STUNNED, 5], [QUICKENED]]);
  assert("quickened and stunned 5: no actions", r.actions, 0);
  assert("quickened and stunned 5: takes 4 stacks", r.stunnedDeduct, 4);
  assert("stunned effect to deduct", r.stunnedEffectId, "stunned");

  r = actions([[STUNNED, 1]], { effectDurations: { stunned: 10 } });
  assert("stunned for a duration: no actions", r.actions, 0);
  assert("stunned for a duration: no stacks taken", r.stunnedDeduct, 0);
  assert("stunned for a duration: flagged", r.stunnedForDuration, true);
  r = actions([[{ ...STUNNED, duration: 1, durationUnit: "minutes" }, 1], [QUICKENED]]);
  assert("stunned whose effect has a duration: no actions, even quickened", r.actions, 0);
  r = actions([[STUNNED, 2]], { effectDurations: { stunned: null } });
  assert("an empty applied duration is still a value", r.actions, 1);
}

section("getTurnStartActionsMessage");
{
  const message = (conditions, extra) => ctx.getTurnStartActionsMessage(actions(conditions, extra));
  assert("no conditions: no message", message([]), "");
  assert("slowed", message([[SLOWED, 1]]), "**2 actions** this turn (slowed 1).");
  assert("quickened", message([[QUICKENED]]), "**4 actions** this turn (quickened).");
  assert("stunned with stacks left", message([[STUNNED, 4]]), "**0 actions** this turn (stunned 4 takes 3, now stunned 1).");
  assert(
    "stunned counted toward slowed",
    message([[STUNNED, 1], [SLOWED, 2]]),
    "**1 action** this turn (stunned 1 takes 1, stunned ends; slowed 2, counting the 1 lost to stunned).",
  );
  assert(
    "stunned for a duration",
    message([[STUNNED, 1], [SLOWED, 1]], { effectDurations: { stunned: 10 } }),
    "**0 actions** this turn (stunned for its duration; slowed 1).",
  );
  assert(
    "quickened and slowed",
    message([[QUICKENED], [SLOWED, 1]]),
    "**3 actions** this turn (quickened; slowed 1).",
  );
}

section("getTurnEndFrightened");
{
  assert("frightened 2: take a stack off", ctx.getTurnEndFrightened(tokenWith([[FRIGHTENED, 2]]))?._id, "frightened");
  assert("not frightened", ctx.getTurnEndFrightened(tokenWith([[SLOWED, 1]])), null);
  assert("dead: left alone", ctx.getTurnEndFrightened(tokenWith([[FRIGHTENED, 2], [DEAD]])), null);
  assert("no token", ctx.getTurnEndFrightened(undefined), null);
  const spiral = effect("Spell Effect: Spiral of Horrors", 0, "indefinite", "spiral");
  assert("Spiral of Horrors: frightened 1 stays", ctx.getTurnEndFrightened(tokenWith([[spiral], [FRIGHTENED, 1]])), null);
  assert("Spiral of Horrors: frightened 3 goes down", ctx.getTurnEndFrightened(tokenWith([[spiral], [FRIGHTENED, 3]]))?._id, "frightened");
  assert("no floor effect: floor 0", ctx.getFrightenedFloor(tokenWith([[FRIGHTENED, 2]])), 0);
}

section("onTurnEnd hook");
{
  settings = {};
  runHook("onTurnEnd.js", { token: tokenWith([[FRIGHTENED, 2]]) });
  assert("frightened goes down by 1", calls, [["deduct", "frightened", "tok"]]);
  runHook("onTurnEnd.js", {
    token: tokenWith([[FRIGHTENED, 2]], { data: { conditionUpkeepStartRound: 2 } }),
  });
  assert("frightened: turn noted as ended", calls, [
    ["deduct", "frightened", "tok"],
    ["set", "tok", { "data.conditionUpkeepEndRound": 2 }],
  ]);
  runHook("onTurnEnd.js", { token: tokenWith([[FRIGHTENED, 1], [DEAD]]) });
  assert("dead creature: no change", calls, []);
  settings = { conditionUpkeep: "no" };
  runHook("onTurnEnd.js", { token: tokenWith([[FRIGHTENED, 2]]) });
  assert("setting off: no change", calls, []);
  settings = {};
}

section("onTurnStart hook");
{
  settings = {};
  runHook("onTurnStart.js", { token: tokenWith([[STUNNED, 4]]) });
  assert("stunned 4: three stacks taken, then the round noted", calls, [
    ["deduct", "stunned", "tok"],
    ["deduct", "stunned", "tok"],
    ["deduct", "stunned", "tok"],
    ["set", "tok", { "data.conditionUpkeepStartRound": 1 }],
  ]);
  assert("one chat line", state.messages, ["**0 actions** this turn (stunned 4 takes 3, now stunned 1)."]);
  runHook("onTurnStart.js", { token: tokenWith([[STUNNED, 3], [FRIGHTENED, 1]]) });
  assert("stunned 3 ends: one removal, not three deducts", calls, [
    ["remove", "stunned", "tok"],
    ["set", "tok", { "data.conditionUpkeepStartRound": 1 }],
  ]);
  runHook("onTurnStart.js", { token: tokenWith([[SLOWED, 1]], { recordType: "characters" }) });
  assert("character slowed: message", state.messages, ["**2 actions** this turn (slowed 1)."]);
  assert("slowed: nothing deducted", calls, [
    ["set", "tok", { "data.conditionUpkeepStartRound": 1 }],
  ]);
  runHook("onTurnStart.js", { token: tokenWith([]) });
  assert("no conditions: no message", state.messages, []);
  combatRound = null;
  runHook("onTurnStart.js", { token: tokenWith([[STUNNED, 1]], { data: { conditionUpkeepStartRound: 1 } }) });
  assert("round unreadable: upkeep still runs", calls, [["remove", "stunned", "tok"]]);
  combatRound = 1;
  runHook("onTurnStart.js", { token: tokenWith([[STUNNED, 2], [DEAD]]) });
  assert("dead: no message", state.messages, []);
  assert("dead: stunned left alone", calls, []);
  settings = { conditionUpkeep: "no" };
  runHook("onTurnStart.js", { token: tokenWith([[STUNNED, 2]]) });
  assert("setting off: no message", state.messages, []);
  assert("setting off: stunned left alone", calls, []);
  settings = {};
}

section("Next after Previous runs a turn's hooks again");
{
  // Realm's Previous runs no hooks and restores nothing, so the hooks see the
  // token as the first run left it. Deducts and writes apply to the token.
  settings = {};
  let token = tokenWith([[STUNNED, 4], [FRIGHTENED, 2]]);
  const saved = {
    deduct: ctx.api.deductEffectById,
    remove: ctx.api.removeEffectById,
    set: ctx.api.setValuesOnTokenById,
  };
  ctx.api.deductEffectById = (effectId, tok, cb) => {
    const i = token.effectIds.indexOf(effectId);
    if (i >= 0) token.effectIds.splice(i, 1);
    if (cb) cb();
  };
  ctx.api.removeEffectById = (effectId, tok, cb) => {
    token.effectIds = token.effectIds.filter((id) => id !== effectId);
    if (cb) cb();
  };
  ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
    for (const [path, value] of Object.entries(values)) {
      token.data[path.replace(/^data\./, "")] = value;
    }
    if (cb) cb();
  };
  const count = (id) => token.effectIds.filter((x) => x === id).length;
  const run = (file) => runHook(file, { token: JSON.parse(JSON.stringify(token)) });
  combatRound = 3;
  run("onTurnStart.js");
  assert("first start: stunned 4 takes 3", [count("stunned"), state.messages], [
    1,
    ["**0 actions** this turn (stunned 4 takes 3, now stunned 1)."],
  ]);
  run("onTurnStart.js");
  assert("same turn started again: nothing", [count("stunned"), state.messages], [1, []]);
  run("onTurnEnd.js");
  assert("first end: frightened 2 -> 1", count("frightened"), 1);
  run("onTurnEnd.js");
  assert("same turn ended again: frightened stays 1", count("frightened"), 1);
  run("onTurnStart.js");
  assert("start again after its end, same round: nothing", [count("stunned"), state.messages], [1, []]);
  combatRound = 4;
  run("onTurnStart.js");
  assert("next round: stunned 1 takes 1", [count("stunned"), state.messages], [
    0,
    ["**2 actions** this turn (stunned 1 takes 1, stunned ends)."],
  ]);
  run("onTurnEnd.js");
  assert("next round's end: frightened 1 -> 0", count("frightened"), 0);
  ctx.api.deductEffectById = saved.deduct;
  ctx.api.removeEffectById = saved.remove;
  ctx.api.setValuesOnTokenById = saved.set;
  combatRound = 1;
}

section("getEncounterEndEffects");
{
  const names = (effects, extra) => ctx.getEncounterEndEffects(tokenWith(effects.map((e) => [e]), extra)).map((e) => e.name);
  assert("encounter duration (-1 rounds)", names([effect("Duelist's Challenge", -1, "rounds")]), ["Duelist's Challenge"]);
  assert("stance stored as indefinite", names([effect("Stance: Twinned Defense")]), ["Stance: Twinned Defense"]);
  assert("Panache", names([effect("Panache")]), ["Panache"]);
  assert("Rage", names([effect("Rage", 1, "minutes")]), ["Rage"]);
  assert(
    "the effects that end with the rage",
    names([
      effect("Come and Get Me", 1, "minutes"),
      effect("Come and Get Me (Circumstance Bonus)", 1, "minutes"),
      effect("Come and Get Me (Temporary Hit Points)", 1, "minutes"),
      effect("Giant's Stature"),
      effect("Share Rage", 1, "minutes"),
      effect("Dragon's Rage Wings", 1, "minutes"),
      effect("Animalistic Brutality", 1, "minutes"),
      effect("Desperate Wrath", 1, "minutes"),
      effect("Furious Finish"),
    ]),
    [
      "Come and Get Me",
      "Come and Get Me (Circumstance Bonus)",
      "Come and Get Me (Temporary Hit Points)",
      "Giant's Stature",
      "Share Rage",
      "Dragon's Rage Wings",
      "Animalistic Brutality",
      "Desperate Wrath",
      "Furious Finish",
    ],
  );
  assert(
    "rage immunity, temporary panache, conditions and timed effects stay",
    names([
      effect("Rage Temporary Hit Points Immunity", 1, "minutes"),
      effect("Panache (Temporary)", 1, "end_turn"),
      effect("Panache (Ephemeral Note)"),
      FRIGHTENED,
      effect("Spell Effect: Bless", 1, "minutes"),
      effect("Shield", 1, "start_turn"),
      effect("Burning", 3, "rounds"),
    ]),
    [],
  );
  assert("name match ignores case", names([effect("stance: mountain stance")]), ["stance: mountain stance"]);
  assert(
    "a per-token unit counts",
    names([effect("Odd Effect", -1, "minutes", "odd")], { effectDurationUnits: { odd: "rounds" } }),
    ["Odd Effect"],
  );
  assert("no effects", ctx.getEncounterEndEffects({}), []);
}

section("getEncounterEndRemovals and getEncounterEndSummary");
{
  const stance = effect("Stance: Mountain Stance", -1, "rounds");
  const rage = effect("Rage", 1, "minutes");
  const pc = {
    ...tokenWith([[stance], [rage], [FRIGHTENED]]),
    _id: "t1",
    name: "Amiri",
    recordType: "characters",
    linked: true,
    recordId: "pc1",
  };
  // A second token for the same character
  const pcAgain = { ...pc, _id: "t2" };
  const foe = {
    ...tokenWith([[effect("Panache")]]),
    _id: "t3",
    name: "Gorvo",
    unidentifiedName: "Masked Duelist",
    identified: false,
  };
  const plain = { ...tokenWith([[FRIGHTENED]]), _id: "t4", name: "Bystander" };
  const removals = ctx.getEncounterEndRemovals([pc, pcAgain, foe, plain, null]);
  assert("one entry per record, none for tokens with nothing to end", removals.map((r) => r.token._id), ["t1", "t3"]);
  assert("effects to remove", removals[0].effects.map((e) => e._id), ["Stance: Mountain Stance", "Rage"]);
  assert("unidentified name", removals[1].name, "Masked Duelist");
  assert(
    "summary",
    ctx.getEncounterEndSummary(removals),
    "**Encounter effects ended**\n- Amiri: Stance: Mountain Stance, Rage\n- Masked Duelist: Panache",
  );
  assert("nothing ended: no summary", ctx.getEncounterEndSummary([]), "");
}

section("onEncounterEnd hook");
{
  const pc = {
    ...tokenWith([[effect("Stance: Mountain Stance", -1, "rounds")], [effect("Rage", 1, "minutes")]]),
    _id: "t1",
    name: "Amiri",
    recordType: "characters",
    faction: "friend",
    linked: true,
    recordId: "pc1",
    data: { level: 1 },
  };
  const foe = {
    ...tokenWith([]),
    _id: "t2",
    name: "Goblin",
    recordType: "npcs",
    faction: "enemy",
    data: { level: 1 },
  };
  runHook("onEncounterEnd.js", { tokens: [pc, foe] });
  assert("effects removed one at a time", calls, [
    ["remove", "Stance: Mountain Stance", "t1"],
    ["remove", "Rage", "t1"],
  ]);
  assert("XP message still sent", state.messages[0].includes("XP awarded to each party member"), true);
  assert("summary sent", state.messages[1], "**Encounter effects ended**\n- Amiri: Stance: Mountain Stance, Rage");
  runHook("onEncounterEnd.js", { tokens: [foe] });
  assert("nothing to end: nothing removed or sent", [calls, state.messages], [[], []]);
  const noted = {
    ...pc,
    data: { level: 1, conditionUpkeepStartRound: 2, conditionUpkeepEndRound: 2 },
  };
  runHook("onEncounterEnd.js", { tokens: [noted, { ...noted, _id: "t3" }, foe] });
  assert("noted rounds cleared after the removals, once per record", calls, [
    ["remove", "Stance: Mountain Stance", "t1"],
    ["remove", "Rage", "t1"],
    ["set", "t1", { "data.conditionUpkeepStartRound": null, "data.conditionUpkeepEndRound": null }],
  ]);
}

process.exitCode = summary() > 0 ? 1 : 0;
