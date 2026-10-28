// Tests for stances (rollhandlers/action-limits.js): entering one ends the
// other stance. The ruleset doesn't police the action economy: no flourish,
// press, finisher, hex, composition or spellshape warnings, and no per-turn
// action log. Run: node tests/test-action-limits.js (or via tests/run-all.js)

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

section("No action-economy policing: the GM runs it");
{
  setup();
  startTurn();
  use("Double Slice", ["Flourish", "Fighter"]);
  const second = use("Knockdown", ["Flourish", "Fighter"]);
  assertNotIncludes("a second flourish: no warning", second, "**");
  assertIncludes("the card is as it was", second, "#### Knockdown&nbsp;:one-action:\n\n---");
  assertNotIncludes("press with no attack yet: no warning", use("Certain Strike", ["Press"]), "Press");
  use("Confident Finisher", ["Finisher"]);
  assertNotIncludes("an attack after a finisher: no warning", use("Tumble Through Strike", ["Attack"]), "finisher");
  use("Reach Spell", ["Spellshape"]);
  const spellCard = cast("Evil Eye", ["Hex", "Witch"]);
  assertNotIncludes("no spellshape note on the spell", spellCard, "Spellshape");
  assertNotIncludes("a second hex: no warning", cast("Clinging Ice", ["Hex"]), "One hex");
  assert("nothing is logged on the token", sets.filter(([, , v]) => "data.turnActions" in v || "data.lastComposition" in v), []);
  assert("and no notices", notices, []);
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
