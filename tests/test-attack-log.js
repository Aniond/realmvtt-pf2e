// Tests for the attack log (rollhandlers/attack-log.js): whose turn it is,
// the attacks counted on it, the multiple attack penalty spell attacks and
// attack-trait skill actions take from it, the card's line when a Strike
// button isn't the attack the log counts, and forceful, sweep, twin and
// backswing.
// Run: node tests/test-attack-log.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// --- helpers ----------------------------------------------------------------

// Campaign variables, which every client reads at once
let variables = {};
ctx.api.getCampaignVariable = (name) => variables[name];
ctx.api.setCampaignVariable = (name, value) => {
  variables[name] = value;
};

// Token writes
let sets = [];
ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
  sets.push([id, recordType, values]);
  if (cb) cb();
};

// A level 5 fighter with the given inventory and attack log
function pc(inventory = [], turnAttacks = undefined) {
  return {
    _id: "pc",
    recordType: "characters",
    name: "Valeros",
    effects: [],
    effectIds: [],
    fields: {},
    data: {
      level: 5,
      str: 4,
      dex: 2,
      athletics: 2,
      athleticsMod: 13,
      ancestries: [{ name: "Human", data: { speed: "25 feet", hp: 8 } }],
      classes: [{ name: "Fighter", data: { hp: 10, features: [] } }],
      feats: [],
      bonusFeats: [],
      inventory,
      ...(turnAttacks ? { turnAttacks } : {}),
    },
  };
}

// The fighter's token, which a character's turn is taken with
const pcToken = (record) => ({ _id: "tok", recordType: "characters", recordId: "pc", record, data: record.data });

// An equipped weapon with the given traits
const weapon = (name, traits = [], extra = {}) => ({
  _id: `w-${name}`,
  name,
  recordType: "items",
  data: {
    type: "weapon",
    carried: "equipped",
    itemCategory: "martial",
    group: "sword",
    traits,
    usage: "held-in-one-hand",
    range: 0,
    damage: { dice: 1, die: "d8", damageType: "slashing" },
    runes: { potency: 1, striking: 1, property: [] },
    ...extra,
  },
});

const target = (id) => ({
  token: { _id: id, name: id, recordType: "npcs", effects: [], effectIds: [], record: { name: id }, data: { ac: 18, level: 3, traits: [] } },
  distance: 5,
});

// It is this token's turn
function startTurn(token) {
  ctx.setCurrentTurn(token);
  return variables.pf2eTurn.key;
}

// A log entry
const logged = (kind, extra = {}) => ({ id: `a-${Math.random()}`, kind, name: "", weaponId: null, baseItem: null, targetId: null, degree: 1, ...extra });

// Runs performAttackRoll and captures its roll prompt
function strike(record, item, { targets = [], attackNumber, token = pcToken(record) } = {}) {
  const saved = { getTargets: ctx.api.getTargets, getToken: ctx.api.getToken, promptRoll: ctx.api.promptRoll };
  let captured = { modifiers: [], metadata: {} };
  ctx.api.getTargets = () => targets;
  ctx.api.getToken = () => token;
  ctx.api.promptRoll = (name, dice, modifiers, metadata) => (captured = { modifiers: modifiers || [], metadata: metadata || {} });
  try {
    ctx.performAttackRoll(record, item, "data.inventory.0", attackNumber);
  } finally {
    Object.assign(ctx.api, saved);
  }
  return captured;
}

function runHandler(file, data) {
  ctx.__state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return ctx.__state.messages.join("\n");
}

const named = (mods, name) => (mods || []).filter((mod) => mod.name === name);

// --- tests ------------------------------------------------------------------

section("Whose turn it is");
{
  variables = {};
  const record = pc();
  const token = pcToken(record);
  assert("no turn recorded: no log", ctx.getOpenTurnAttackLog(record, token), null);
  assert("so no attack number", ctx.getNextAttackNumber(record, token), null);

  const key = startTurn(token);
  assert("its turn: an empty log", ctx.getOpenTurnAttackLog(record, token), { turnKey: key, attacks: [] });
  assert("the character's record matches its turn too", ctx.getNextAttackNumber(record), 1);
  assert("another creature's turn: no log", ctx.getOpenTurnAttackLog({ _id: "goblin", recordId: "npc-goblin", data: {} }), null);

  const goblin = { _id: "gob1", recordType: "npcs", recordId: "npc-goblin", data: {} };
  startTurn(goblin);
  assert("goblin 1's turn", ctx.getNextAttackNumber(goblin), 1);
  assert("not goblin 2's, though they share the NPC record", ctx.getNextAttackNumber({ _id: "gob2", recordType: "npcs", recordId: "npc-goblin", data: {} }), null);

  startTurn(token);
  variables.pf2eEncounter = { round: 0, participants: [] };
  assert("encounter over: no log", ctx.getNextAttackNumber(record, token), null);
  variables.pf2eEncounter = { round: 2, participants: [] };
  assert("encounter going: the log", ctx.getNextAttackNumber(record, token), 1);

  runHandler("onEncounterEnd.js", { tokens: [] });
  assert("onEncounterEnd: no one's turn", ctx.getNextAttackNumber(record, token), null);
  runHandler("onRoundStart.js", { round: 1, tokens: [token] });
  runHandler("onTurnStart.js", { token, tokens: [token] });
  assert("onTurnStart records it", variables.pf2eTurn.tokenId, "tok");
  assert("with the character's record", variables.pf2eTurn.recordId, "pc");
  assert("it is the fighter's turn", ctx.getNextAttackNumber(record, token), 1);
  variables = {};
}

section("Counting this turn's attacks");
{
  const record = pc();
  const token = pcToken(record);
  const key = startTurn(token);
  record.data.turnAttacks = { turnKey: key, attacks: [logged("strike")] };
  assert("one attack: this is the 2nd", ctx.getNextAttackNumber(record, token), 2);
  record.data.turnAttacks.attacks.push(logged("maneuver"));
  assert("a maneuver counts: 3rd", ctx.getNextAttackNumber(record, token), 3);
  record.data.turnAttacks.attacks.push(logged("spell"));
  assert("later ones stay at the 3rd's penalty", ctx.getNextAttackNumber(record, token), 3);
  startTurn(token);
  assert("a new turn: the old log doesn't count", ctx.getNextAttackNumber(record, token), 1);

  assert("MAP for the 1st: none", ctx.getTurnMapModifiers(1), []);
  assert("2nd: -5, ticked", ctx.getTurnMapModifiers(2).map((m) => [m.name, m.value, m.active]), [["Multiple Attack Penalty (2nd attack)", -5, true]]);
  assert("3rd: -10", ctx.getTurnMapModifiers(3)[0].value, -10);
  assert("off its turn: none", ctx.getTurnMapModifiers(null), []);

  assert("hint: button 1 on the 2nd attack", ctx.getAttackNumberHint(1, 2), "This is the 2nd attack this turn, rolled as the 1st.");
  assert("hint: none when they match", ctx.getAttackNumberHint(2, 2), "");
  assert("hint: none off its turn", ctx.getAttackNumberHint(1, null), "");
  variables = {};
}

section("Logging an attack's result");
{
  const record = pc();
  const token = pcToken(record);
  assert("off its turn: nothing to log", ctx.getTurnAttackMetadata(token, record, { kind: "strike" }), null);
  const key = startTurn(token);
  const first = ctx.getTurnAttackMetadata(token, record, { kind: "strike", name: "Longsword", weaponId: "w1", baseItem: "longsword", targetId: "orc" });
  assert("its turn: the token to write to", [first.tokenId, first.recordType], ["tok", "characters"]);
  assert("and the entry", [first.entry.kind, first.entry.weaponId, first.entry.targetId], ["strike", "w1", "orc"]);
  const values = ctx.getLoggedTurnAttackValues(first, 0);
  assert("the result adds it, with its degree", values["data.turnAttacks"].attacks.map((a) => [a.weaponId, a.degree]), [["w1", 0]]);
  assert("for this turn", values["data.turnAttacks"].turnKey, key);
  record.data.turnAttacks = values["data.turnAttacks"];
  const rerolled = ctx.getLoggedTurnAttackValues({ ...first, log: record.data.turnAttacks }, 2);
  assert("a reroll replaces it, not a second attack", rerolled["data.turnAttacks"].attacks.map((a) => a.degree), [2]);
  assert("no DC: degree unknown", ctx.getLoggedTurnAttackValues(first, null)["data.turnAttacks"].attacks[0].degree, null);
  assert("nothing to log: nothing written", ctx.getLoggedTurnAttackValues(null, 1), null);

  // attack.js logs the result and shows the hint
  sets = [];
  const card = runHandler("attack.js", {
    roll: {
      dice: [{ type: 20, value: 15 }],
      total: 25,
      metadata: { dc: 18, attack: "Longsword", traits: [], damage: "2d8 slashing", turnAttack: first, attackNumberHint: "This is the 2nd attack this turn, rolled as the 1st." },
    },
  });
  assert("attack.js writes the log to the token", sets.map(([id, type, v]) => [id, type, v["data.turnAttacks"].attacks.map((a) => a.degree)]), [["tok", "characters", [1]]]);
  assertIncludes("and the card says which attack it was", card, "This is the 2nd attack this turn, rolled as the 1st.");
  sets = [];
  runHandler("attack.js", { roll: { dice: [{ type: 20, value: 15 }], total: 25, metadata: { dc: 18, attack: "Longsword", traits: [], damage: "2d8 slashing" } } });
  assert("off its turn: attack.js writes nothing", sets, []);
  variables = {};
}

section("Strikes: the buttons, the hint, the log");
{
  const sword = weapon("Longsword");
  const record = pc([sword]);
  const token = pcToken(record);

  // Off the creature's turn: as before
  let roll = strike(record, sword, { attackNumber: 2 });
  assert("off its turn: button 2 is -5", named(roll.modifiers, "Mutliple Attack Penalty").map((m) => m.value), [-5]);
  assert("no hint", roll.metadata.attackNumberHint, "");
  assert("nothing logged", roll.metadata.turnAttack, null);

  const key = startTurn(token);
  roll = strike(record, sword, { attackNumber: 1 });
  assert("1st attack, button 1: no penalty", named(roll.modifiers, "Mutliple Attack Penalty"), []);
  assert("no hint", roll.metadata.attackNumberHint, "");
  assert("logged as a Strike with this weapon", [roll.metadata.turnAttack.entry.kind, roll.metadata.turnAttack.entry.weaponId], ["strike", "w-Longsword"]);

  record.data.turnAttacks = { turnKey: key, attacks: [logged("strike", { weaponId: "w-Longsword" })] };
  roll = strike(record, sword, { attackNumber: 1 });
  assert("2nd attack, button 1: the button wins", named(roll.modifiers, "Mutliple Attack Penalty"), []);
  assert("and the card says so", roll.metadata.attackNumberHint, "This is the 2nd attack this turn, rolled as the 1st.");
  roll = strike(record, sword, { attackNumber: 2 });
  assert("button 2: -5, no hint", [named(roll.modifiers, "Mutliple Attack Penalty").map((m) => m.value), roll.metadata.attackNumberHint], [[-5], ""]);
  roll = strike(record, sword, {});
  assert("no button (Elemental Blast): the log sets -5", named(roll.modifiers, "Mutliple Attack Penalty").map((m) => m.value), [-5]);
  roll = strike(record, sword, { targets: [target("orc")], attackNumber: 2 });
  assert("against a target: its id is logged", roll.metadata.turnAttack.entry.targetId, "orc");
  variables = {};
}

section("Momentum traits");
{
  const twin = { ...weapon("Sai", ["twin"]), _id: "sai-1" };
  const log = (attacks) => ({ turnKey: "k", attacks });
  const mods = (item, attacks, opts = {}) => ctx.getMomentumTraitModifiers(log(attacks), { ...item, _id: item._id }, { damageDice: 2, ...opts });
  const forceful = weapon("Warhammer", ["forceful"]);
  const hammer = (extra = {}) => logged("strike", { weaponId: "w-Warhammer", ...extra });
  assert("forceful, 1st attack: nothing", mods(forceful, []).damage, []);
  assert("forceful, 2nd with it: +1 per die", mods(forceful, [hammer()]).damage.map((m) => [m.name, m.type, m.value]), [["Forceful", "circumstance", 2]]);
  assert("3rd: +2 per die", mods(forceful, [hammer(), hammer()]).damage[0].value, 4);
  assert("after attacks with another weapon only: nothing", mods(forceful, [logged("strike", { weaponId: "w-other" }), logged("spell")]).damage, []);

  const sai2 = { ...twin, _id: "sai-2" };
  assert("twin, after the other sai: +1 per die", mods(sai2, [logged("strike", { weaponId: "sai-1", baseItem: "sai" })]).damage.map((m) => [m.name, m.value]), [["Twin", 2]]);
  assert("not after the same sai", mods(twin, [logged("strike", { weaponId: "sai-1", baseItem: "sai" })]).damage, []);
  assert("not after a different weapon type", mods(sai2, [logged("strike", { weaponId: "dagger", baseItem: "dagger" })]).damage, []);

  const sweep = weapon("Scimitar", ["forceful", "sweep"]);
  const scimitar = (targetId, degree = 1) => logged("strike", { weaponId: "w-Scimitar", targetId, degree });
  assert("sweep, a different target than before: +1", mods(sweep, [scimitar("orc")], { targetId: "goblin" }).attack.map((m) => [m.name, m.type, m.value]), [["Sweep", "circumstance", 1]]);
  assert("the same target: nothing", mods(sweep, [scimitar("orc")], { targetId: "orc" }).attack, []);
  assert("no target: nothing", mods(sweep, [scimitar("orc")]).attack, []);

  const backswing = weapon("Greatpick", ["backswing"]);
  const pick = (degree) => logged("strike", { weaponId: "w-Greatpick", degree });
  assert("backswing, after a miss with it: +1", mods(backswing, [pick(0)]).attack.map((m) => m.name), ["Backswing"]);
  assert("after a critical miss too", mods(backswing, [pick(-1)]).attack.length, 1);
  assert("only the attack right after it", mods(backswing, [pick(0), pick(1)]).attack, []);
  assert("not after a hit", mods(backswing, [pick(1)]).attack, []);
  assert("not when the result is unknown (no DC)", mods(backswing, [pick(null)]).attack, []);
  assert("no log: nothing", ctx.getMomentumTraitModifiers(null, forceful, { damageDice: 2 }), { attack: [], damage: [] });

  // In a Strike
  const record = pc([forceful]);
  const token = pcToken(record);
  const key = startTurn(token);
  record.data.turnAttacks = { turnKey: key, attacks: [hammer({ degree: 0 })] };
  const roll = strike(record, forceful, { attackNumber: 2 });
  assert("a Strike's damage has forceful, +1 per die (2 with striking)", named(roll.metadata.damageModifiers, "Forceful").map((m) => m.value), [2]);

  const sweepRecord = pc([sweep]);
  const sweepToken = pcToken(sweepRecord);
  const sweepKey = startTurn(sweepToken);
  sweepRecord.data.turnAttacks = { turnKey: sweepKey, attacks: [scimitar("orc")] };
  const vsGoblin = strike(sweepRecord, sweep, { attackNumber: 2, targets: [target("goblin")] });
  assert("sweep in the Strike's prompt against the new target", named(vsGoblin.modifiers, "Sweep").map((m) => m.value), [1]);
  const vsOrc = strike(sweepRecord, sweep, { attackNumber: 2, targets: [target("orc")] });
  assert("not against the same one", named(vsOrc.modifiers, "Sweep"), []);
  variables = {};
}

section("Spell attacks take MAP from the log");
{
  const ray = { name: "Ray of Frost", data: { defense: { passive: { statistic: "ac" } }, traits: ["attack", "cantrip"], damage: [] } };
  const caster = pc();
  const token = pcToken(caster);
  const macro = ctx.getSpellAttackMacro(caster, ray, { data: { dc: 20, attribute: "int", attack: 10 } }, "data.spells.0", null);
  const body = String(macro).replace(/^```Roll_Attack\n/, "").replace(/```\s*$/, "");
  const cast = (targets) => {
    const saved = { ...ctx.api };
    let captured = null;
    ctx.api.getRecord = (type, id, cb) => cb(caster);
    ctx.api.getValueOnRecord = (r, path) => (path === "data.spells.0" ? ray : null);
    ctx.api.getTargets = () => targets;
    ctx.api.getToken = () => token;
    ctx.api.promptRoll = (name, dice, modifiers, metadata) => (captured = { modifiers, metadata });
    try {
      new vm.Script(body, { filename: "spell-attack-macro.js" }).runInContext(ctx);
    } finally {
      Object.assign(ctx.api, saved);
    }
    return captured;
  };
  let roll = cast([target("orc")]);
  assert("off its turn: no penalty", named(roll.modifiers, "Multiple Attack Penalty (2nd attack)"), []);
  assert("nothing logged", roll.metadata.turnAttack, null);
  const key = startTurn(token);
  caster.data.turnAttacks = { turnKey: key, attacks: [logged("strike")] };
  roll = cast([target("orc")]);
  assert("after a Strike: -5, ticked", named(roll.modifiers, "Multiple Attack Penalty (2nd attack)").map((m) => [m.value, m.active]), [[-5, true]]);
  assert("logged as a spell against the target", [roll.metadata.turnAttack.entry.kind, roll.metadata.turnAttack.entry.targetId], ["spell", "orc"]);
  roll = cast([]);
  assert("no target: still -5, still logged", [named(roll.modifiers, "Multiple Attack Penalty (2nd attack)").length, roll.metadata.turnAttack.entry.kind], [1, "spell"]);
  variables = {};
}

section("Attack-trait skill actions take MAP from the log");
{
  const record = pc();
  const token = pcToken(record);
  const trip = () => {
    const saved = { getTargets: ctx.api.getTargets, getToken: ctx.api.getToken, promptRoll: ctx.api.promptRoll };
    let captured = null;
    ctx.api.getTargets = () => [target("orc")];
    ctx.api.getToken = () => token;
    ctx.api.promptRoll = (name, dice, modifiers, metadata) => (captured = { modifiers, metadata });
    try {
      ctx.performSkillAction(record, "athletics", "Trip");
    } finally {
      Object.assign(ctx.api, saved);
    }
    return captured;
  };
  const ticks = (roll) => (roll.modifiers || []).filter((m) => /Multiple Attack Penalty/.test(m.name)).map((m) => [m.value, m.active]);
  let roll = trip();
  assert("off its turn: both offered, unticked, as before", ticks(roll), [[-5, false], [-10, false]]);
  assert("nothing logged", roll.metadata.turnAttack, undefined);
  const key = startTurn(token);
  roll = trip();
  assert("1st attack: none ticked", ticks(roll), [[-5, false], [-10, false]]);
  assert("logged as a maneuver against the target", [roll.metadata.turnAttack.entry.kind, roll.metadata.turnAttack.entry.name, roll.metadata.turnAttack.entry.targetId], ["maneuver", "Trip", "orc"]);
  record.data.turnAttacks = { turnKey: key, attacks: [logged("strike")] };
  assert("after a Strike: the 2nd's -5 ticked", ticks(trip()), [[-5, true], [-10, false]]);
  record.data.turnAttacks.attacks.push(logged("strike"));
  assert("after two: the 3rd's -10", ticks(trip()), [[-5, false], [-10, true]]);

  // skill.js logs the result
  sets = [];
  roll = trip();
  runHandler("skill.js", { roll: { dice: [{ type: 20, value: 12 }], total: 20, metadata: { ...roll.metadata, dc: 17 } } });
  assert("skill.js logs the Trip with its degree", sets.map(([id, , v]) => [id, v["data.turnAttacks"].attacks.map((a) => [a.kind, a.degree])]), [["tok", [["strike", 1], ["strike", 1], ["maneuver", 1]]]]);
  sets = [];
  runHandler("skill.js", { roll: { dice: [{ type: 20, value: 12 }], total: 20, metadata: { dc: 17, rollName: "Athletics: Climb" } } });
  assert("other skill checks log nothing", sets, []);
  variables = {};
}

process.exitCode = summary() > 0 ? 1 : 0;
