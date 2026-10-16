// Tests for condition upkeep in the turn hooks (frightened, stunned, slowed,
// quickened), the effects that end with an encounter, a creature's own
// condition values (self:condition:<slug>:<n>, @actor.conditions.<slug>.value),
// curse penalties as plain modifiers, and modifiers to a condition's value
// when gained.

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


// --- condition values, curse penalties, condition gain ----------------------

// Effect and data writes the Apply buttons and hooks make (curse penalties
// must make none)
ctx.api.addEffects = (names, token) => {
  calls.push(["add", names, token?._id]);
};
ctx.api.addEffect = (name, token, duration, value) => {
  calls.push(["addOne", name, token?._id, value]);
};
ctx.api.addEffectById = (effectId, token) => {
  calls.push(["addById", effectId, token?._id]);
};
ctx.api.removeEffectById = (effectId, token, cb, options) => {
  calls.push(options ? ["remove", effectId, token?._id, options] : ["remove", effectId, token?._id]);
  if (cb) cb();
};
ctx.api.setValuesOnRecord = (rec, values, cb) => {
  calls.push(["setRecord", rec?._id, values]);
  if (cb) cb(rec);
};

const CURSEBOUND = { ...effect("Cursebound", 0, "indefinite", "cursebound"), stackable: true };
const UNCONSCIOUS = effect("Unconscious", 0, "indefinite", "unconscious");
const PERSISTENT = {
  ...effect("Persistent Damage", 0, "indefinite", "persistent"),
  rules: [{ type: "persistentDamage", valueType: "api" }],
};

// A class feature with these modifiers
const feature = (name, modifiers, extra = {}) => ({
  _id: `f-${name}`,
  name,
  recordType: "features",
  data: { level: 1, modifiers: modifiers.map((data) => ({ data })), ...extra },
});
// A curse's condition as a plain modifier: a status penalty of the same type
// and field as the campaign's condition record has (Clumsy: allPenalty
// status on dex), equal to the cursebound value
const cursePenalty = (
  type,
  field,
  predicate = '["self:condition:cursebound"]',
  value = "@actor.conditions.cursebound.value",
) => ({ type, modifierType: "status", field, valueType: "number", value, predicate });
const MEDDLING = feature("Curse of Ancestral Meddling", [cursePenalty("allPenalty", "dex")]);
const SKYS_CALL = feature("Curse of the Sky's Call", [
  cursePenalty("allPenalty", "str"),
  cursePenalty("damagePenalty", "str"),
]);
const TORRENTIAL = feature("Curse of Torrential Knowledge", [
  { type: "saveBonus", modifierType: "status", field: "will", valueType: "number", value: "-@actor.conditions.cursebound.value", predicate: '["self:condition:cursebound"]' },
  ...["int", "wis", "cha"].map((field) => cursePenalty("allPenalty", field, '["self:condition:cursebound:4"]', "1")),
]);

// A level 5 oracle token with these conditions, class features and data
function oracle(conditions, features, extra = {}) {
  const token = tokenWith(conditions);
  return {
    ...token,
    _id: "oracle",
    name: "Korakai",
    recordType: "characters",
    ...extra,
    data: {
      level: 5,
      classes: [{ name: "Oracle", data: { features } }],
      feats: [],
      ...(extra.data || {}),
    },
  };
}
const traitList = (token, context = {}) => [...ctx.collectTraitsAndProperties(token, context)];
const passes = (token, predicate, context = {}) =>
  ctx.evaluateEffectPredicate(predicate, ctx.collectTraitsAndProperties(token, context), token, context);

section("self condition values");
{
  const two = oracle([[CURSEBOUND, 2]], []);
  const traits = traitList(two);
  assert("self:condition:cursebound:2", traits.includes("self:condition:cursebound:2"), true);
  assert("bare self:condition:cursebound still there", traits.includes("self:condition:cursebound"), true);
  assert("unvalued effects get :1", traitList(oracle([[UNCONSCIOUS]], [])).includes("self:condition:unconscious:1"), true);
  assert('{"gte":["self:condition:cursebound",2]} at 2', passes(two, [{ gte: ["self:condition:cursebound", 2] }]), true);
  assert("... fails at 1", passes(oracle([[CURSEBOUND, 1]], []), [{ gte: ["self:condition:cursebound", 2] }]), false);
  assert("... fails without the condition", passes(oracle([], []), [{ gte: ["self:condition:cursebound", 2] }]), false);
  assert('{"lt":["self:condition:cursebound",3]} at 2', passes(two, [{ lt: ["self:condition:cursebound", 3] }]), true);
  assert("self:condition:cursebound:4 only at 4", [passes(two, ["self:condition:cursebound:4"]), passes(oracle([[CURSEBOUND, 4]], []), ["self:condition:cursebound:4"])], [false, true]);
  // The numeric atom wins over the bare one on the target side too
  const scared = { ...tokenWith([[FRIGHTENED, 2]]), _id: "foe" };
  assert('{"gte":["target:condition:frightened",2]} with a frightened 2 target', passes(oracle([], []), [{ gte: ["target:condition:frightened", 2] }], { targets: [scared] }), true);
  assert("skill ranks still compare", passes(oracle([], [], { data: { athletics: "2" } }), [{ gte: ["skill:athletics:rank", 2] }]), true);
}

section("@actor.conditions.<slug>.value");
{
  const replace = (value, token) => ctx.checkForReplacements(value, {}, token);
  const two = oracle([[CURSEBOUND, 2]], []);
  assert("the value", replace("@actor.conditions.cursebound.value", two), "2");
  assert("0 without the condition", replace("@actor.conditions.cursebound.value", oracle([], [])), "0");
  assert("badge spelling", replace("@actor.conditions.cursebound.badge.value", two), "2");
  assert("@self.condition.<slug>", replace("@self.condition.cursebound", two), "2");
  assert("formula worked out: -level times value", replace("-@actor.level*@actor.conditions.cursebound.value", two), "-10");
  assert("ternary picks 5 + level at cursebound 3", replace("ternary(gte(@actor.conditions.cursebound.value,3),5+@actor.level,2)", oracle([[CURSEBOUND, 3]], [])), "10");
  assert("... and 2 below it", replace("ternary(gte(@actor.conditions.cursebound.value,3),5+@actor.level,2)", two), "2");
  assert("a damage value keeps its type", replace("@actor.conditions.cursebound.value fire", two), "2 fire");
  assert("text without tokens is left alone", replace("4/8", two), "4/8");
  assert("dice are left alone", replace("1d6+@actor.level", two), "1d6+5");
  const will = (token) =>
    ctx.getEffectsAndModifiersForToken(token, ["saveBonus"], "will").filter((m) => m.name === "Curse of Torrential Knowledge");
  const atTwo = will(oracle([[CURSEBOUND, 2]], [TORRENTIAL]));
  assert("a number value starting with -@ is a formula: -2 at cursebound 2", [atTwo[0]?.value, atTwo[0]?.active], ["-2", true]);
  assert("not cursebound: inactive", will(oracle([], [TORRENTIAL]))[0]?.active ?? false, false);
  const plain = feature("Plain", [{ type: "saveBonus", modifierType: "status", field: "will", valueType: "number", value: "2" }]);
  assert("a plain number is unchanged", ctx.getEffectsAndModifiersForToken(oracle([], [plain]), ["saveBonus"], "will")[0]?.value, 2);
}

// The campaign's condition effect records, as the PF2e campaigns have them:
// rules scaled by @effect.count
const CLUMSY_RECORD = {
  _id: "clumsy-record",
  name: "Clumsy",
  stackable: true,
  rules: [{ type: "allPenalty-status", field: "dex", valueType: "string", value: "@effect.count" }],
};
const FRIGHTENED_RECORD = {
  _id: "frightened-record",
  name: "Frightened",
  stackable: true,
  rules: [{ type: "allPenalty-status", field: "all", valueType: "string", value: "@effect.count" }],
};
const QUICKENED_RECORD = { _id: "quickened-record", name: "Quickened", stackable: false, rules: [] };

// An oracle who can roll: Reflex +9, Acrobatics +8, Athletics +6, AC 20 on
// the sheet
function roller(conditions, features, extra = {}) {
  const token = oracle(conditions, features, extra);
  token.fields = {};
  token.data = {
    dex: 3,
    reflex: "2",
    reflexMod: 9,
    will: "1",
    willMod: 7,
    acrobatics: "1",
    acrobaticsMod: 8,
    athletics: "1",
    athleticsMod: 6,
    ac: 20,
    bonusFeats: [],
    inventory: [],
    ...token.data,
  };
  return token;
}
// A real condition as the token has it: the campaign's record, value stacks
const real = (record, value) => [record, value];
// The roll's bonus as the prompt totals it: every active modifier
function rollBonus(run) {
  const saved = ctx.api.promptRoll;
  let total = null;
  ctx.api.promptRoll = (name, dice, modifiers) => {
    total = (modifiers || [])
      .filter((m) => m.active !== false)
      .reduce((sum, m) => sum + (parseInt(m.value, 10) || 0), 0);
  };
  try {
    run();
  } finally {
    ctx.api.promptRoll = saved;
  }
  return total;
}
const reflex = (token) => rollBonus(() => ctx.rollSave(token, "reflex"));
const acrobatics = (token) => rollBonus(() => ctx.rollSkill(token, "acrobatics"));
const will = (token) => rollBonus(() => ctx.rollSave(token, "will"));
const athletics = (token) => rollBonus(() => ctx.rollSkill(token, "athletics"));
const ac = (token) => ctx.getArmorClassForToken(token);
const numbers = (token) => [acrobatics(token), reflex(token), ac(token), ctx.getSaveDCForToken(token, "reflex")];
const BASE = [8, 9, 20, 19];

section("curse penalties: plain modifiers, at the final numbers");
{
  calls = [];
  assert("no curse: Acrobatics, Reflex, AC, Reflex DC unchanged", numbers(roller([[CURSEBOUND, 2]], [])), BASE);
  assert("curse clumsy at cursebound 2: -2 to Dex checks, Reflex, AC and Reflex DC", numbers(roller([[CURSEBOUND, 2]], [MEDDLING])), [6, 7, 18, 17]);
  assert("cursebound 1: -1, read live", numbers(roller([[CURSEBOUND, 1]], [MEDDLING])), [7, 8, 19, 18]);
  assert("cursebound 3: -3", numbers(roller([[CURSEBOUND, 3]], [MEDDLING])), [5, 6, 17, 16]);
  assert("not cursebound: no penalty", numbers(roller([], [MEDDLING])), BASE);
  assert("nothing written to the token or record", calls, []);
  // The sheet's AC (data.ac) holds armorClass modifiers only, so the
  // roll-time AC above counts the curse's clumsy once
  const written = {};
  ctx.updateAttribute({ record: roller([[CURSEBOUND, 2]], [MEDDLING]), attribute: "dex", value: 3, moreValuesToSet: written });
  const plainSheet = {};
  ctx.updateAttribute({ record: roller([[CURSEBOUND, 2]], []), attribute: "dex", value: 3, moreValuesToSet: plainSheet });
  assert("the sheet AC leaves the curse penalty out", [typeof written["data.ac"], written["data.ac"]], ["number", plainSheet["data.ac"]]);
  // A feature's AC modifier is already in data.ac: not counted again
  const ward = feature("Ward", [{ type: "armorClassBonus", modifierType: "circumstance", field: "all", valueType: "number", value: "1" }]);
  assert("a feature's armorClassBonus is still read from the sheet only", ac(roller([], [ward])), 20);
  // A feature's penalty to all checks and DCs counts for AC (frightened-like)
  const dread = feature("Dread", [{ type: "allPenalty", modifierType: "status", field: "all", valueType: "number", value: "1" }]);
  assert("a feature's allPenalty status all: -1 AC", ac(roller([], [dread])), 19);
}

section("curse penalties: typed stacking with the real condition");
{
  assert("real clumsy 1 + curse clumsy 2: -2, not -3", numbers(roller([[CURSEBOUND, 2], real(CLUMSY_RECORD, 1)], [MEDDLING])), [6, 7, 18, 17]);
  assert("real clumsy 3 + curse clumsy 2: -3", numbers(roller([[CURSEBOUND, 2], real(CLUMSY_RECORD, 3)], [MEDDLING])), [5, 6, 17, 16]);
  assert("real clumsy 2 + curse clumsy 2: -2", numbers(roller([[CURSEBOUND, 2], real(CLUMSY_RECORD, 2)], [MEDDLING])), [6, 7, 18, 17]);
  assert("real clumsy 1, no curse: -1 (unchanged)", numbers(roller([real(CLUMSY_RECORD, 1)], [])), [7, 8, 19, 18]);
  assert("real frightened 1 + curse clumsy 2: Reflex -2 (status penalties, the worst applies)", reflex(roller([[CURSEBOUND, 2], real(FRIGHTENED_RECORD, 1)], [MEDDLING])), 7);
  assert("real frightened 3 + curse clumsy 2: Reflex -3", reflex(roller([[CURSEBOUND, 2], real(FRIGHTENED_RECORD, 3)], [MEDDLING])), 6);
  // The curse doesn't make the creature clumsy: no condition atom
  assert("no self:condition:clumsy from the curse", traitList(roller([[CURSEBOUND, 2]], [MEDDLING])).includes("self:condition:clumsy"), false);
}

section("curse penalties: enfeebled, stupefied, Giant Instinct");
{
  assert("Sky's Call at cursebound 2: Athletics -2", athletics(roller([[CURSEBOUND, 2]], [SKYS_CALL])), 4);
  assert("... not cursebound: unchanged", athletics(roller([], [SKYS_CALL])), 6);
  const strDamage = (token) =>
    ctx.getEffectsAndModifiersForToken(token, ["damageBonus", "damagePenalty"], "str").filter((m) => m.active !== false).map((m) => parseInt(m.value, 10));
  assert("... and -2 to Strength damage", strDamage(roller([[CURSEBOUND, 2]], [SKYS_CALL])), [-2]);
  // Torrential Knowledge: Will takes the curse's status penalty; stupefied 1
  // at cursebound 4 is a status penalty too, so only the worst applies
  assert("Torrential Knowledge at cursebound 3: Will -3", will(roller([[CURSEBOUND, 3]], [TORRENTIAL])), 4);
  assert("... at cursebound 4: Will -4 (stupefied 1 doesn't add)", will(roller([[CURSEBOUND, 4]], [TORRENTIAL])), 3);
  const wisMods = (token) =>
    ctx.getEffectsAndModifiersForToken(token, ["allBonus", "allPenalty"], "wis").filter((m) => m.active !== false).map((m) => parseInt(m.value, 10));
  assert("... stupefied 1 only at cursebound 4", [wisMods(roller([[CURSEBOUND, 3]], [TORRENTIAL])), wisMods(roller([[CURSEBOUND, 4]], [TORRENTIAL]))], [[], [-1]]);
  // Giant Instinct: clumsy 1 while its toggle (wielding the larger weapon) is on
  const giant = feature("Giant Instinct", [{ type: "allPenalty", modifierType: "status", field: "dex", valueType: "number", value: "1", predicate: '["item:oversized"]' }], { toggleable: true, predicateValue: "item:oversized" });
  const toggles = (toggled) => ({ data: { toggles: [{ name: "Giant Instinct", data: { predicateValue: "item:oversized", toggled } }] } });
  assert("Giant Instinct toggled on: -1 to Dex checks, Reflex, AC and Reflex DC", numbers(roller([], [giant], toggles(true))), [7, 8, 19, 18]);
  assert("Giant Instinct toggled off: unchanged", numbers(roller([], [giant], toggles(false))), BASE);
  assert("toggled on with real clumsy 2: -2", numbers(roller([real(CLUMSY_RECORD, 2)], [giant], toggles(true))), [6, 7, 18, 17]);
}

section("upkeep reads real effects only");
{
  assert("real quickened: 4 actions", ctx.getTurnStartActions(roller([[QUICKENED_RECORD, 1]], [])).actions, 4);
  assert("no quickened: 3 actions", ctx.getTurnStartActions(roller([], [])).actions, 3);
  assert("real frightened 1: its stack comes off at turn end", ctx.getTurnEndFrightened(roller([real(FRIGHTENED_RECORD, 1)], []))?._id, "frightened-record");
  const dealt = (token) => {
    state.messages = [];
    const rolled = [];
    const savedRoll = ctx.api.roll;
    ctx.api.roll = (formula) => rolled.push(formula);
    try {
      runHook("onTurnEnd.js", { token });
    } finally {
      ctx.api.roll = savedRoll;
    }
    const flat = state.messages
      .map((m) => (m.match(/```Apply_(.+?)_Persistent_Damage/) || [])[1])
      .filter(Boolean)
      .map((v) => v.replace(/_/g, " "));
    return [...rolled, ...flat];
  };
  const burning = (cursebound, instances) =>
    roller(
      [...(cursebound ? [[CURSEBOUND, cursebound]] : []), ...(instances ? [[PERSISTENT]] : [])],
      [],
      { effectValues: instances ? { persistent: instances } : {} },
    );
  assert("real persistent 2 fire: dealt", dealt(burning(0, ["2 fire"])), ["2 fire"]);
  assert("cursebound with no persistent damage effect: nothing (Engulfing Flames is manual)", dealt(burning(2)), []);
  assert("two instances: each with its recovery index", ctx.getTurnEndPersistentDamage(burning(0, [{ value: "1d4 fire", _id: "foe", name: "Goblin" }, "1d6 bleed"])), [{ value: "1d4 fire", partIndex: 0 }, { value: "1d6 bleed", partIndex: 1 }]);
}

section("turn end: persistent damage recovery check (G2)");
{
  const charhide = feature("Charhide Goblin", [{ type: "persistentRecoveryDC", modifierType: "none", field: "fire", valueType: "number", value: "10" }]);
  const onFire = (features) => oracle([[PERSISTENT]], features, { effectValues: { persistent: "5 fire" } });
  runHook("onTurnEnd.js", { token: onFire([]) });
  assert("flat persistent damage: a DC 15 recovery check", state.messages.some((m) => m.includes("Roll_Recovery") && m.includes("{ dc: 15,")), true);
  runHook("onTurnEnd.js", { token: onFire([charhide]) });
  assert("Charhide Goblin, fire: DC 10", state.messages.some((m) => m.includes("{ dc: 10,")), true);
  let rolled = null;
  const savedRoll = ctx.api.roll;
  ctx.api.roll = (formula, metadata) => {
    rolled = metadata;
  };
  try {
      runHook("onTurnEnd.js", { token: oracle([[PERSISTENT]], [charhide], { effectValues: { persistent: "1d6 fire" } }) });
    assert("rolled persistent fire damage carries recoveryDC 10", rolled?.recoveryDC, 10);
      runHook("onTurnEnd.js", { token: oracle([[PERSISTENT]], [charhide], { effectValues: { persistent: "1d6 bleed" } }) });
    assert("... bleed carries 15", rolled?.recoveryDC, 15);
  } finally {
    ctx.api.roll = savedRoll;
  }
}

section("condition gain: Bravery");
{
  const bravery = feature("Bravery", [{ type: "conditionGain", modifierType: "none", field: "Frightened", valueType: "number", value: "-1" }], { level: 3 });
  const fighter = (features = [bravery]) => ({ ...oracle([], features), _id: "fighter", name: "Valeros" });
  const gain = (token, name, value) => ctx.getConditionGainValue(token, name, value).value;
  assert("frightened 2 gained: 1", gain(fighter(), "Frightened", 2), 1);
  assert("frightened 1 gained: 0", gain(fighter(), "Frightened", 1), 0);
  assert("name match ignores case", gain(fighter(), "frightened", 3), 2);
  assert("another condition: unchanged", gain(fighter(), "Clumsy", 2), 2);
  assert("without Bravery: unchanged", gain(fighter([]), "Frightened", 2), 2);
  const gated = feature("Gated", [{ type: "conditionGain", modifierType: "none", field: "Frightened", valueType: "number", value: "-1", predicate: '["self:effect:rage"]' }]);
  assert("a failing predicate: unchanged", gain(fighter([gated]), "Frightened", 2), 2);
  const worse = feature("Worse", [{ type: "conditionGain", modifierType: "none", field: "Frightened", valueType: "number", value: "1" }]);
  assert("a positive change raises it", gain(fighter([worse]), "Frightened", 1), 2);

  // applyEffect (one call per value) and the Apply buttons go through it
  const savedTargets = ctx.api.getSelectedOrDroppedToken;
  try {
    ctx.api.getSelectedOrDroppedToken = () => [fighter()];
    calls = [];
    state.messages = [];
    ctx.applyEffect("Frightened", 2);
    assert("applyEffect frightened 2 on Bravery: one stack", calls, [["add", ["Frightened"], "fighter"]]);
    assert("and a chat line", state.messages[0], "Valeros gains frightened 1 instead of 2 (Bravery).");
    calls = [];
    state.messages = [];
    ctx.applyEffect("Frightened", 1);
    assert("applyEffect frightened 1 on Bravery: nothing added", calls, []);
    assert("and a chat line", state.messages[0], "Valeros doesn't gain frightened (Bravery).");
    ctx.api.getSelectedOrDroppedToken = () => [fighter([])];
    calls = [];
    state.messages = [];
    ctx.applyEffect("Frightened", 2);
    assert("without Bravery: both stacks, no chat line", [calls, state.messages], [[["add", ["Frightened", "Frightened"], "fighter"]], []]);
  } finally {
    ctx.api.getSelectedOrDroppedToken = savedTargets;
  }
  calls = [];
  ctx.applyEffectButton("frightened-id", "Frightened", fighter(), { _id: "foe" });
  assert("Apply button on Bravery: frightened not added", calls, []);
  ctx.applyEffectButton("frightened-id", "Frightened", fighter([]), { _id: "foe" });
  assert("Apply button without Bravery: added by id", calls, [["addById", "frightened-id", "fighter"]]);
  const savedGetToken = ctx.api.getToken;
  ctx.api.getToken = () => ({ _id: "foe", name: "Goblin" });
  const macro = ctx.getEffectMacrosFor([JSON.stringify({ _id: "frightened-id", name: "Frightened" }), JSON.stringify({ _id: "x", name: "Ogre's Fear" })]);
  ctx.api.getToken = savedGetToken;
  assert("Apply buttons call applyEffectButton with the value", macro.includes("applyEffectButton('frightened-id', 'Frightened', target, ourToken, 1);"), true);
  assert("names with quotes are escaped", macro.includes("applyEffectButton('x', 'Ogre\\'s Fear', target, ourToken, 1);"), true);
}

section("condition gain: once per gain, not per stack (Bravery, Player Core pg. 136)");
{
  const bravery = feature("Bravery", [{ type: "conditionGain", modifierType: "none", field: "Frightened", valueType: "number", value: "-1" }], { level: 3 });
  const fighter = (conditions = [], features = [bravery]) => ({ ...oracle(conditions, features), _id: "fighter", name: "Valeros" });
  // The stacks one click of an Apply button for this value adds
  const click = (token, name, value) => {
    calls = [];
    state.messages = [];
    ctx.applyEffectButton(`${name.toLowerCase()}-id`, name, token, { _id: "foe" }, value);
    return calls;
  };
  assert("Bravery, frightened 1: nothing (0)", click(fighter(), "Frightened", 1), []);
  assert("Bravery, frightened 2 (critical Demoralize): frightened 1, kept who applied it", click(fighter(), "Frightened", 2), [["addById", "frightened-id", "fighter"]]);
  assert("and one chat line for the gain", state.messages, ["Valeros gains frightened 1 instead of 2 (Bravery)."]);
  assert("Bravery, frightened 3: frightened 2 in one write", click(fighter(), "Frightened", 3), [["add", ["Frightened", "Frightened"], "fighter"]]);
  assert("no Bravery, frightened 1: frightened 1", click(fighter([], []), "Frightened", 1), [["addById", "frightened-id", "fighter"]]);
  assert("no Bravery, frightened 2: frightened 2", click(fighter([], []), "Frightened", 2), [["add", ["Frightened", "Frightened"], "fighter"]]);
  assert("no Bravery: no chat line", state.messages, []);
  assert("Bravery, clumsy 2: unchanged", click(fighter(), "Clumsy", 2), [["add", ["Clumsy", "Clumsy"], "fighter"]]);
  // A gain of a condition already held: the higher value (Player Core pg. 442)
  assert("frightened 1 already, Bravery gain of 3 (2): one more stack", click(fighter([[FRIGHTENED, 1]]), "Frightened", 3), [["addById", "frightened-id", "fighter"]]);
  assert("frightened 2 already, gain of frightened 2: nothing added", click(fighter([[FRIGHTENED, 2]], []), "Frightened", 2), []);
  // applyEffect takes the value as one gain too
  const savedTargets = ctx.api.getSelectedOrDroppedToken;
  try {
    ctx.api.getSelectedOrDroppedToken = () => [fighter()];
    const apply = (value) => {
      calls = [];
      ctx.applyEffect("Frightened", value);
      return calls;
    };
    assert("applyEffect, Bravery: 1 -> 0", apply(1), []);
    assert("applyEffect, Bravery: 2 -> 1", apply(2), [["add", ["Frightened"], "fighter"]]);
    assert("applyEffect, Bravery: 3 -> 2", apply(3), [["add", ["Frightened", "Frightened"], "fighter"]]);
  } finally {
    ctx.api.getSelectedOrDroppedToken = savedTargets;
  }

  // One button per value the ability gives the condition
  const savedGetToken = ctx.api.getToken;
  ctx.api.getToken = () => ({ _id: "foe", name: "Goblin" });
  const demoralize = ctx.getEffectMacrosFor(
    [JSON.stringify({ _id: "frightened-id", name: "Frightened" })],
    "**Critical Success** The target becomes frightened 2.\n**Success** The target becomes frightened 1.",
  );
  const set = ctx.getEffectMacrosFor([JSON.stringify({ _id: "frightened-id", name: "Frightened", value: 3 })], "frightened 1");
  const plain = ctx.getEffectMacrosFor([JSON.stringify({ _id: "prone-id", name: "Prone" })], "You fall prone.");
  ctx.api.getToken = savedGetToken;
  assert("Demoralize: an Apply button for frightened 1", demoralize.includes("```Apply_Frightened_1\n") && demoralize.includes("ourToken, 1);"), true);
  assert("Demoralize: and one for frightened 2", demoralize.includes("```Apply_Frightened_2\n") && demoralize.includes("ourToken, 2);"), true);
  assert("a value on the effect wins", [set.includes("```Apply_Frightened_3\n"), set.includes("ourToken, 1);")], [true, false]);
  assert("no value named: one button for 1, named as before", [plain.includes("```Apply_Prone\n"), plain.includes("ourToken, 1);")], [true, true]);
}

process.exitCode = summary() > 0 ? 1 : 0;
