// Tests for dying, wounded and doomed (rollhandlers/dying.js): the dying value
// a character dies at, recovery checks, damage at 0 Hit Points, healing out
// of dying, Heroic Recovery, Orc Ferocity, Administer First Aid and rest.
// Run: node tests/test-dying.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const state = ctx.__state;

// The API calls dying.js makes. Callbacks run right away.
let calls = [];
const log = (call) => calls.push(call);
ctx.api.removeEffectById = (effectId, token, cb) => {
  log(["remove", effectId, token?._id]);
  if (cb) cb();
};
ctx.api.addEffect = (name, token) => log(["add", name, token?._id]);
ctx.api.addEffects = (names, token) => log(["add", ...names, token?._id]);
ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
  log(["set", id, values]);
  state.lastSet = values;
  if (cb) cb();
};
ctx.api.setValuesOnRecord = (target, values, cb) => {
  log(["setRecord", target?._id, values]);
  if (cb) cb();
};
let notices = [];
ctx.api.showNotification = (message) => notices.push(message);
let selected = [];
ctx.api.getSelectedOrDroppedToken = () => selected;
const reset = () => {
  calls = [];
  notices = [];
  state.messages = [];
  state.lastSet = null;
};

// The module's conditions are effects; a stackable one is on a token once
// per stack (effectIds)
const effect = (name) => ({ _id: name.toLowerCase(), name, stackable: true, rules: [] });
const feat = (name) => ({ _id: `feat-${name}`, name, data: { type: "general" } });

// A character token: data, feats by name, conditions as [[name, value], ...]
function pc(data = {}, { feats = [], conditions = [], id = "pc" } = {}) {
  const effects = [];
  const effectIds = [];
  for (const [name, value] of conditions) {
    const e = effect(name);
    effects.push(e);
    for (let i = 0; i < (value || 1); i++) effectIds.push(e._id);
  }
  return {
    _id: id,
    recordId: `${id}-record`,
    recordType: "characters",
    name: "Valeros",
    record: { name: "Valeros", ownerId: "player" },
    identified: true,
    effects,
    effectIds,
    data: { curhp: 20, hitpoints: 20, level: 5, dying: 0, wounded: 0, heroPoints: 0, feats: feats.map(feat), ...data },
  };
}

section("The dying value a character dies at");
{
  assert("dying 4", ctx.getDeathThreshold(pc()), 4);
  assert("Diehard: dying 5", ctx.getDeathThreshold(pc({}, { feats: ["Diehard"] })), 5);
  assert("doomed 1: dying 3", ctx.getDeathThreshold(pc({}, { conditions: [["Doomed", 1]] })), 3);
  assert("Diehard and doomed 2: dying 3", ctx.getDeathThreshold(pc({}, { feats: ["Diehard"], conditions: [["Doomed", 2]] })), 3);
  assert("doomed 4: 0", ctx.getDeathThreshold(pc({}, { conditions: [["Doomed", 4]] })), 0);
  assert("wounded stops at 3", ctx.getWoundedMax(pc()), 3);
  assert("or 4 with Diehard", ctx.getWoundedMax(pc({}, { feats: ["Diehard"] })), 4);
  assert("recovery check DC: 10 + dying", ctx.getRecoveryCheckDC(pc({ dying: 2 })), 12);
  assert("Toughness: 1 lower", ctx.getRecoveryCheckDC(pc({ dying: 2 }, { feats: ["Toughness"] })), 11);
}

section("Dying from damage");
{
  assert("knocked out: dying 1", ctx.getDyingAfterDamage(pc(), false), 1);
  assert("by a critical hit: dying 2", ctx.getDyingAfterDamage(pc(), true), 2);
  assert("wounded 2 adds 2", ctx.getDyingAfterDamage(pc({ wounded: 2 }), false), 3);
  assert("already dying 1: 1 more", ctx.getDyingAfterDamage(pc({ dying: 1, wounded: 2 }), false), 2);
  assert("already dying 1, critical hit: 2 more", ctx.getDyingAfterDamage(pc({ dying: 1, wounded: 2 }), true), 3);

  const zero = (target, options = {}) => {
    reset();
    const valuesToSet = {};
    const oldValues = {};
    const result = ctx.getZeroHitPointsChanges(target, { valuesToSet, oldValues, ...options });
    return { ...result, valuesToSet, oldValues, calls };
  };
  let r = zero(pc({ curhp: 0 }));
  assert("dying 1, unconscious and prone", [r.valuesToSet["data.dying"], r.calls], [1, [["add", "Unconscious", "Prone", "pc"]]]);
  assert("the message says so", r.lines, ["Valeros gains Dying 1."]);
  assert("no Hero Points: no button", r.buttons, []);
  r = zero(pc({ curhp: 0, wounded: 2 }), { critical: true });
  assert("wounded 2 and a critical hit: dying 4, dead", [r.valuesToSet["data.dying"], r.calls], [4, [["add", "Dead", "pc"]]]);
  r = zero(pc({ curhp: 0, wounded: 2 }, { feats: ["Diehard"] }), { critical: true });
  assert("with Diehard, dying 4 isn't dead", [r.valuesToSet["data.dying"], r.calls], [4, [["add", "Unconscious", "Prone", "pc"]]]);
  r = zero(pc({ curhp: 0, wounded: 2 }, { conditions: [["Doomed", 1]] }));
  assert("doomed 1: dead at dying 3", [r.valuesToSet["data.dying"], r.calls[0]], [3, ["add", "Dead", "pc"]]);
  r = zero(pc({ curhp: 0 }, { conditions: [["Doomed", 4]] }));
  assert("doomed 4: dead on gaining dying", r.calls, [["add", "Dead", "pc"]]);
  r = zero(pc({ curhp: 0, dying: 2 }, { conditions: [["Unconscious", 1]] }));
  assert("already dying and unconscious: dying 3, no second Unconscious", [r.valuesToSet["data.dying"], r.oldValues["data.dying"], r.calls], [3, 2, []]);
  assert("the message says it went up", r.lines, ["Valeros's dying value goes up to 3."]);

  r = zero(pc({ curhp: 0 }), { nonlethal: true });
  assert("nonlethal: knocked out, not dying", ["data.dying" in r.valuesToSet, r.calls], [false, [["add", "Unconscious", "Prone", "pc"]]]);
  assertIncludes("and the message says so", r.lines[0], "knocked out by nonlethal damage");
  r = zero(pc({ curhp: 0, dying: 1 }, { conditions: [["Unconscious", 1]] }), { nonlethal: true });
  assert("nonlethal damage while dying still raises it", r.valuesToSet["data.dying"], 2);

  r = zero(pc({ curhp: 0, heroPoints: 2 }));
  assert("with Hero Points: a Heroic Recovery button for this token", r.buttons.length, 1);
  assertIncludes("the button names the token", r.buttons[0], 'withChatButtonToken("pc", "Valeros"');
  assertIncludes("and calls Heroic Recovery", r.buttons[0], "heroicRecovery(token)");
  r = zero(pc({ curhp: 0, heroPoints: 2 }), { nonlethal: true });
  assert("not for a nonlethal knockout", r.buttons, []);
  r = zero(pc({ curhp: 0 }, { feats: ["Orc Ferocity"] }));
  assertIncludes("Orc Ferocity: a button", r.buttons[0] || "", 'useOrcFerocity(token, {"dying":0,"addedUnconscious":true})');
  r = zero(pc({ curhp: 0, orcFerocityUsed: true }, { feats: ["Orc Ferocity"] }));
  assert("not once used today", r.buttons, []);
  r = zero(pc({ curhp: 0, orcFerocityUsed: true }, { feats: ["Orc Ferocity", "Incredible Ferocity"] }));
  assert("unless Incredible Ferocity (once an hour, which the GM tracks)", r.buttons.length, 1);
}

section("Damage through applyDamage");
{
  const roll = (value, { traits = [], critical = false } = {}) => ({
    types: [{ die: 6, value, type: "slashing" }],
    dice: [{ type: 6, value }],
    total: value,
    metadata: { traits, damageCategories: [], damageType: "slashing", critical },
  });
  const hit = (target, damageRoll) => {
    reset();
    ctx.applyDamage(target, damageRoll, false, null, false);
    return { set: calls.filter((c) => c[0] === "set")[0]?.[2] || {}, calls, message: state.messages[state.messages.length - 1] || "" };
  };
  let r = hit(pc({ curhp: 5, inventory: [] }), roll(9));
  assert("a character knocked out: 0 HP, dying 1", [r.set["data.curhp"], r.set["data.dying"]], [0, 1]);
  assert("unconscious and prone", r.calls.some((c) => c[0] === "add" && c.includes("Unconscious")), true);
  r = hit(pc({ curhp: 5, inventory: [], heroPoints: 1 }, { feats: ["Orc Ferocity"] }), roll(9));
  assertIncludes("the Heroic Recovery button comes after the Undo button", r.message, "```Undo");
  assert("both buttons are there", [r.message.includes("```Heroic_Recovery"), r.message.includes("```Orc_Ferocity")], [true, true]);
  assert("and outside the Undo button's text", r.message.indexOf("```Heroic_Recovery") > r.message.indexOf("```Undo"), true);
  r = hit(pc({ curhp: 5, inventory: [] }, { feats: ["Diehard"] }), roll(9));
  assert("Diehard changes nothing at dying 1", r.set["data.dying"], 1);
  r = hit(pc({ curhp: 5, inventory: [] }), roll(9, { traits: ["nonlethal"] }));
  assert("nonlethal: no dying", "data.dying" in r.set, false);
  const npc = (data = {}) => ({ _id: "npc", recordType: "npcs", name: "Goblin", record: { name: "Goblin" }, identified: true, effects: [], data: { curhp: 5, hitpoints: 20, ...data } });
  r = hit(npc(), roll(9));
  assert("an NPC dies at 0 HP", r.calls.some((c) => c[0] === "add" && c[1] === "Dead"), true);
  r = hit(npc(), roll(9, { traits: ["nonlethal"] }));
  assert("but is knocked out by nonlethal damage", [r.calls.some((c) => c[1] === "Dead"), r.calls.some((c) => c.includes("Unconscious"))], [false, true]);
  assertIncludes("which the message says", r.message, "knocked out by nonlethal damage");
  r = hit(npc({ type: "hazard" }), roll(9, { traits: ["nonlethal"] }));
  assert("an object is destroyed either way", r.calls.some((c) => c[1] === "Dead"), true);

  // Healing through applyDamage (negative damage)
  const heal = (target, amount) => {
    reset();
    // Vitality damage with the vitality trait heals the living (a Heal spell)
    ctx.applyDamage(target, { types: [{ die: 8, value: amount, type: "vitality" }], dice: [{ type: 8, value: amount }], total: amount, metadata: { traits: ["vitality"], damageCategories: [], damageType: "vitality" } }, false, null, false);
    return { set: calls.filter((c) => c[0] === "set")[0]?.[2] || {}, calls, message: state.messages[state.messages.length - 1] || "" };
  };
  r = heal(pc({ curhp: 0, dying: 2, wounded: 1, inventory: [] }, { conditions: [["Unconscious", 1]] }), 5);
  assert("a Heal spell from 0: dying 0, wounded 2", [r.set["data.curhp"], r.set["data.dying"], r.set["data.wounded"]], [5, 0, 2]);
  assert("and awake", r.calls.some((c) => c[0] === "remove" && c[1] === "unconscious"), true);
  assertIncludes("the message says so", r.message, "No longer dying (wounded 2)");
  assertIncludes("and its Undo button restores dying and wounded", r.message, '"data.dying":2,"data.wounded":1');
}

section("Healing out of dying");
{
  const changes = (target, oldHp, newHp, fromRest) => ctx.getHealingChanges(target, oldHp, newHp, fromRest);
  const dying = pc({ curhp: 0, dying: 2, wounded: 1 }, { conditions: [["Unconscious", 1]] });
  assert("at 1 HP or more: dying 0, wounded +1, awake", changes(dying, 0, 4), { values: { "data.dying": 0, "data.wounded": 2 }, wake: true });
  assert("wounded stops at 3", changes(pc({ curhp: 0, dying: 1, wounded: 3 }), 0, 4).values["data.wounded"], 3);
  assert("or 4 with Diehard", changes(pc({ curhp: 0, dying: 1, wounded: 3 }, { feats: ["Diehard"] }), 0, 4).values["data.wounded"], 4);
  const knockedOut = pc({ curhp: 0 }, { conditions: [["Unconscious", 1]] });
  assert("knocked out, not dying: awake, no wounded", changes(knockedOut, 0, 3), { values: {}, wake: true });
  assert("natural healing from rest wakes them too", changes(knockedOut, 0, 3, true).wake, true);
  const asleep = pc({ curhp: 12 }, { conditions: [["Unconscious", 1]] });
  assert("asleep with Hit Points: healing wakes them", changes(asleep, 12, 15).wake, true);
  assert("but not natural healing from rest", changes(asleep, 12, 15, true).wake, false);
  assert("no healing: nothing", changes(dying, 0, 0), { values: {}, wake: false });

  reset();
  ctx.applyHealingToToken(dying, 6);
  assert("Apply Healing: HP, dying and wounded in one write", calls[0], ["set", "pc", { "data.curhp": 6, "data.dying": 0, "data.wounded": 2 }]);
  assert("and Unconscious comes off", calls[1], ["remove", "unconscious", "pc"]);
  assertIncludes("the chat line says so", state.messages[0], "Valeros healed for 6 HP, no longer dying (wounded 2).");
  assertIncludes("its Undo button restores all three", state.messages[0], '{"data.curhp":0,"data.dying":2,"data.wounded":1}');
  reset();
  ctx.applyHealingToToken(pc({ curhp: 10, wounded: 2 }), 30, { treatWounds: true });
  assert("Treat Wounds: up to max HP, and wounded ends", calls[0], ["set", "pc", { "data.curhp": 20, "data.wounded": 0 }]);
  reset();
  ctx.applyHealingToToken(pc({ curhp: 10, wounded: 2 }), 5);
  assert("other healing leaves wounded alone", calls[0], ["set", "pc", { "data.curhp": 15 }]);
}

section("Heroic Recovery");
{
  ctx.isGM = true;
  reset();
  ctx.heroicRecovery(pc({ curhp: 0, dying: 3, wounded: 1, heroPoints: 2 }));
  assert("spends all Hero Points and ends dying, wounded unchanged", calls[0], ["set", "pc", { "data.heroPoints": 0, "data.dying": 0 }]);
  assertIncludes("the chat line says so", state.messages[0], "spending 2 Hero Points");
  reset();
  ctx.heroicRecovery(pc({ curhp: 0, dying: 4, heroPoints: 1 }, { conditions: [["Dead", 1]] }));
  assert("a death from the increase is undone", calls[1], ["remove", "dead", "pc"]);
  reset();
  ctx.heroicRecovery(pc({ curhp: 0, dying: 2, heroPoints: 0 }));
  assert("without Hero Points: nothing", [calls, notices.length], [[], 1]);
  reset();
  ctx.heroicRecovery(pc({ curhp: 10, heroPoints: 1 }));
  assert("not dying: nothing", [calls, notices.length], [[], 1]);
  ctx.isGM = false;
  ctx.userId = "someone-else";
  reset();
  ctx.heroicRecovery(pc({ curhp: 0, dying: 2, heroPoints: 1 }));
  assert("another player can't use it on this character", [calls, notices.length], [[], 1]);
  ctx.userId = "player";
  reset();
  ctx.heroicRecovery(pc({ curhp: 0, dying: 2, heroPoints: 1 }));
  assert("its owner can", calls.length, 1);
  ctx.isGM = true;
  delete ctx.userId;
}

section("Orc Ferocity");
{
  reset();
  ctx.useOrcFerocity(pc({ curhp: 0, dying: 1, wounded: 1 }, { feats: ["Orc Ferocity"], conditions: [["Unconscious", 1], ["Prone", 1]] }), { dying: 0, addedUnconscious: true });
  assert("1 HP, dying back to before, wounded +1, used", calls[0], ["set", "pc", { "data.curhp": 1, "data.dying": 0, "data.wounded": 2, "data.orcFerocityUsed": true }]);
  assert("the knockout comes off", calls.slice(1), [["remove", "unconscious", "pc"], ["remove", "prone", "pc"]]);
  reset();
  ctx.useOrcFerocity(pc({ curhp: 0, dying: 1, tempHp: 2 }, { feats: ["Orc Ferocity", "Undying Ferocity"] }), { dying: 0 });
  assert("Undying Ferocity: temporary HP equal to level", calls[0][2]["data.tempHp"], 5);
  reset();
  ctx.useOrcFerocity(pc({ curhp: 0, dying: 1, orcFerocityUsed: true }, { feats: ["Orc Ferocity"] }), { dying: 0 });
  assert("once a day", [calls, notices.length], [[], 1]);
  reset();
  ctx.useOrcFerocity(pc({ curhp: 0, dying: 4 }, { feats: ["Orc Ferocity"], conditions: [["Dead", 1]] }), { dying: 2 });
  assert("a death from that hit is undone too", [calls[0][2]["data.dying"], calls[1]], [2, ["remove", "dead", "pc"]]);
}

section("Recovery checks");
{
  const result = (target, degree) => ctx.getRecoveryCheckResult(target, degree);
  const dying2 = pc({ curhp: 0, dying: 2, wounded: 1 });
  assert("critical success: dying 0, wounded +1", result(dying2, 2), { values: { "data.dying": 0, "data.wounded": 2 }, dying: 0, dead: false });
  assert("success: dying 1", result(dying2, 1), { values: { "data.dying": 1 }, dying: 1, dead: false });
  assert("failure: dying 3", result(dying2, 0), { values: { "data.dying": 3 }, dying: 3, dead: false });
  assert("critical failure: dying 4, dead", result(dying2, -1), { values: { "data.dying": 4 }, dying: 4, dead: true });
  assert("Diehard: dying 4 alive", result(pc({ curhp: 0, dying: 3 }, { feats: ["Diehard"] }), 0).dead, false);
  assert("Diehard: dying 5 dead", result(pc({ curhp: 0, dying: 3 }, { feats: ["Diehard"] }), -1), { values: { "data.dying": 5 }, dying: 5, dead: true });
  assert("doomed 2: dead at dying 2", result(pc({ curhp: 0, dying: 1 }, { conditions: [["Doomed", 2]] }), 0).dead, true);

  // The roll handler
  const runRecovery = (character, natural, metadata = {}) => {
    reset();
    ctx.api.getRecord = (type, id, cb) => cb(character);
    ctx.api.getToken = () => ({ _id: "pc", recordType: "characters" });
    ctx.record = { _id: "sheet", recordType: "characters" };
    ctx.data = { roll: { dice: [{ type: 20, value: natural }], total: natural, metadata } };
    const code = fs.readFileSync(`${__dirname}/../rollhandlers/recovery.js`, "utf8");
    new vm.Script(`(function () {\n${code}\n})();`, { filename: "recovery.js" }).runInContext(ctx);
    return { calls, message: state.messages[0] || "" };
  };
  let r = runRecovery(pc({ curhp: 0, dying: 1, wounded: 1 }), 15);
  assert("success at dying 1: dying 0, wounded 2", r.calls, [["setRecord", "pc", { "data.dying": 0, "data.wounded": 2 }]]);
  assertIncludes("against DC 11", r.message, "vs DC 11");
  r = runRecovery(pc({ curhp: 0, dying: 1 }, { feats: ["Toughness"] }), 10);
  assertIncludes("Toughness: DC 10, so a 10 succeeds", r.message, "SUCCESS");
  r = runRecovery(pc({ curhp: 0, dying: 3, heroPoints: 1 }), 5, { tokenId: "pc" });
  assert("failure at dying 3: dead at 4", [r.calls[0], r.calls[1]], [["setRecord", "pc", { "data.dying": 4 }], ["add", "Dead", "pc"]]);
  assertIncludes("the message says so", r.message, "DEAD (Dying 4)");
  assertIncludes("with Hero Points, a Heroic Recovery button", r.message, "```Heroic_Recovery");
  r = runRecovery(pc({ curhp: 0, dying: 2, heroPoints: 1 }), 15);
  assertNotIncludes("not when dying went down", r.message, "Heroic_Recovery");
  r = runRecovery(pc({ curhp: 10, dying: 0 }), 15);
  assert("not dying: nothing changes", r.calls, []);
  assertIncludes("and the message says why", r.message, "isn't dying");
}

section("The recovery check at the start of a dying character's turn");
{
  let round = 3;
  ctx.api.getCombatTracker = (cb) => cb({ round });
  ctx.api.getSetting = () => "no";
  const runTurnStart = (token) => {
    reset();
    ctx.data = { token };
    const code = fs.readFileSync(`${__dirname}/../rollhandlers/onTurnStart.js`, "utf8");
    new vm.Script(`(function () {\n${code}\n})();`, { filename: "onTurnStart.js" }).runInContext(ctx);
    return { calls, messages: state.messages };
  };
  let r = runTurnStart(pc({ curhp: 0, dying: 2, heroPoints: 1 }));
  assertIncludes("a chat line asks for the check", r.messages[0], "**Valeros is dying** (dying 2, dies at dying 4). Attempt a recovery check: DC 12 flat check.");
  assertIncludes("with a button to roll it for this token", r.messages[0], 'withChatButtonToken("pc", "Valeros"');
  assertIncludes("and one for Heroic Recovery", r.messages[0], "```Heroic_Recovery");
  assert("this round is remembered", r.calls, [["set", "pc", { "data.recoveryPromptRound": 3 }]]);
  r = runTurnStart(pc({ curhp: 0, dying: 2, recoveryPromptRound: 3 }));
  assert("not again in the same round", r.messages, []);
  r = runTurnStart(pc({ curhp: 10 }));
  assert("not when not dying", r.messages, []);
  r = runTurnStart(pc({ curhp: 0, dying: 4 }, { conditions: [["Dead", 1]] }));
  assert("not when dead", r.messages, []);
  r = runTurnStart({ ...pc({ curhp: 0, dying: 1 }), recordType: "npcs" });
  assert("not for NPCs", r.messages, []);
}

section("Chat buttons act on their own token");
{
  let ran = null;
  const target = pc();
  selected = [{ token: target }];
  reset();
  ctx.withChatButtonToken("pc", "Valeros", null, (token) => (ran = token._id));
  assert("the selected token with that id", ran, "pc");
  ran = null;
  selected = [{ token: pc({}, { id: "other" }) }];
  ctx.withChatButtonToken("pc", "Valeros", null, (token) => (ran = token._id));
  assert("another selected token: nothing", [ran, notices], [null, ["Select Valeros's token, then click again."]]);
  ctx.withChatButtonToken("pc", "Valeros", target, (token) => (ran = token._id));
  assert("the token it was dropped on", ran, "pc");
  selected = [];
}

section("Rest");
{
  assert("full HP: wounded ends", ctx.getRestWoundedChanges(pc({ curhp: 20, wounded: 2 }), 20), { "data.wounded": 0 });
  assert("not at full HP: it stays", ctx.getRestWoundedChanges(pc({ curhp: 10, wounded: 2 }), 15), {});
  assert("not wounded: nothing", ctx.getRestWoundedChanges(pc({ curhp: 20 }), 20), {});
}

section("Administer First Aid");
{
  const stabilize = { variant: "stabilize", target: "Valeros", targetId: "pc" };
  let lines = ctx.getFirstAidResultLines(stabilize, 1);
  assert("success: loses dying, stays unconscious", lines[0], "**Valeros loses the dying condition (but remains unconscious).**");
  assertIncludes("with a button for the target's token", lines[1], 'withChatButtonToken("pc", "Valeros"');
  assertIncludes("that stabilizes", lines[1], "applyFirstAidStabilize(token, true)");
  lines = ctx.getFirstAidResultLines(stabilize, -1);
  assertIncludes("critical failure: dying goes up", lines[1], "applyFirstAidStabilize(token, false)");
  assert("failure: nothing", ctx.getFirstAidResultLines(stabilize, 0), []);
  lines = ctx.getFirstAidResultLines({ variant: "stop-bleeding", target: "Valeros", targetId: "pc" }, 1);
  assertIncludes("stop bleeding: a DC 10 flat check", lines[1], 'dc: 10 }, "flatCheck")');

  reset();
  ctx.applyFirstAidStabilize(pc({ curhp: 0, dying: 2, wounded: 1 }), true);
  assert("stabilized: dying 0, wounded +1", calls[0], ["set", "pc", { "data.dying": 0, "data.wounded": 2 }]);
  reset();
  ctx.applyFirstAidStabilize(pc({ curhp: 0, dying: 3 }), false);
  assert("critical failure at dying 3: dead", [calls[0], calls[1]], [["set", "pc", { "data.dying": 4 }], ["add", "Dead", "pc"]]);
  reset();
  ctx.applyFirstAidStabilize(pc({ curhp: 5 }), true);
  assert("not dying: nothing", calls, []);

  assertIncludes("the action's chat message gets a button", ctx.getFirstAidActionMacro({ name: "Administer First Aid", data: { description: "<p>...</p>" } }), "administerFirstAid();");
  assert("unless it has one", ctx.getFirstAidActionMacro({ name: "Administer First Aid", data: { description: "administerFirstAid();" } }), "");
  assert("not other actions", ctx.getFirstAidActionMacro({ name: "Treat Wounds", data: {} }), "");
}

section("The damage and healing scripts");
{
  const runScript = (file, target, value) => {
    reset();
    ctx.record = target;
    ctx.value = value;
    ctx.api.getToken = () => target;
    const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
    new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
    return calls;
  };
  let r = runScript("damageScript.js", pc({ curhp: 4, wounded: 1 }), 10);
  assert("damage to 0: dying 2 with wounded 1", r[0], ["setRecord", "pc", { "data.dying": 2, "data.curhp": 0 }]);
  assert("unconscious and prone", r[1], ["add", "Unconscious", "Prone", "pc"]);
  r = runScript("damageScript.js", pc({ curhp: 0, dying: 3 }), 5);
  assert("dying 3 hit again: dead at 4", [r[0][2]["data.dying"], r[1]], [4, ["add", "Dead", "pc"]]);
  r = runScript("damageScript.js", pc({ curhp: 0, dying: 3 }, { feats: ["Diehard"] }), 5);
  assert("with Diehard, dying 4 isn't", r[1], ["add", "Unconscious", "Prone", "pc"]);
  r = runScript("healingScript.js", pc({ curhp: 0, dying: 1 }, { conditions: [["Unconscious", 1]] }), 5);
  assert("healing from 0: dying 0, wounded 1", r[0], ["setRecord", "pc", { "data.curhp": 5, "data.dying": 0, "data.wounded": 1 }]);
  assert("and awake", r[1], ["remove", "unconscious", "pc"]);
}

process.exitCode = summary();
