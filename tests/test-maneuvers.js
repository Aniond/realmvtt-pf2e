// Tests for maneuvers (rollhandlers/maneuvers.js): the item bonus a weapon
// with the action's trait gives, what each outcome does on the result card,
// and the buttons that apply its conditions.
// Run: node tests/test-maneuvers.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

// A level 5 fighter, trained in Athletics, with the given inventory
function pc(inventory = [], extra = {}) {
  return {
    _id: "pc",
    recordType: "characters",
    name: "Valeros",
    effects: [],
    effectIds: [],
    fields: {},
    data: {
      level: 5,
      str: 3,
      athletics: 1,
      athleticsMod: 10,
      ancestries: [],
      classes: [{ name: "Fighter", data: { features: [] } }],
      feats: [],
      bonusFeats: [],
      inventory,
      ...extra,
    },
  };
}

const weapon = (name, traits, potency = 0, extra = {}) => ({
  _id: `w-${name}`,
  name,
  data: { type: "weapon", carried: "equipped", traits, group: "flail", damage: { dice: 1, die: "d6", damageType: "bludgeoning" }, runes: { potency, striking: 0, property: [] }, ...extra },
});

const goblin = { _id: "goblin", name: "Goblin", recordType: "npcs", identified: true, effects: [], effectIds: [], data: { level: 1, fortitude: 5, reflex: 7, will: 3, traits: ["Goblin"] } };

function capturePrompt(run) {
  const saved = ctx.api.promptRoll;
  let captured = null;
  ctx.api.promptRoll = (name, dice, modifiers, metadata) => {
    captured = { name, modifiers: modifiers || [], metadata: metadata || {} };
  };
  try {
    run();
  } finally {
    ctx.api.promptRoll = saved;
  }
  return captured;
}

const act = (record, skill, action, targets) => {
  ctx.api.getTargets = () => targets;
  return capturePrompt(() => ctx.performSkillAction(record, skill, action));
};

function runHandler(file, data) {
  ctx.__state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return ctx.__state.messages.join("\n");
}

// The code inside a chat button
const buttonCode = (text, label) => {
  const match = text.match(new RegExp("```" + label + "\\n([\\s\\S]*?)\\n```"));
  return match ? match[1] : null;
};

ctx.api.getToken = () => null;

section("A weapon with the action's trait");
{
  const flail = weapon("Flail", ["disarm", "sweep", "trip"], 2);
  const shield = weapon("Spiked Gauntlet", ["agile", "grapple"], 1);
  assert("Trip with a +2 flail: +2 item bonus", ctx.getManeuverWeaponModifiers(pc([flail]), "Trip").map((m) => [m.name, m.type, m.value]), [["Flail", "item", 2]]);
  assert("Disarm too", ctx.getManeuverWeaponModifiers(pc([flail]), "Disarm").map((m) => m.value), [2]);
  assert("not Grapple", ctx.getManeuverWeaponModifiers(pc([flail]), "Grapple"), []);
  assert("the best weapon with the trait", ctx.getManeuverWeaponModifiers(pc([weapon("Old Flail", ["trip"], 1), flail]), "Trip").map((m) => m.value), [2]);
  assert("Grapple with the gauntlet", ctx.getManeuverWeaponModifiers(pc([flail, shield]), "Grapple").map((m) => m.name), ["Spiked Gauntlet"]);
  assert("no potency rune: no bonus", ctx.getManeuverWeaponModifiers(pc([weapon("Plain Flail", ["trip"])]), "Trip"), []);
  assert("not when stowed", ctx.getManeuverWeaponModifiers(pc([{ ...flail, data: { ...flail.data, carried: "carried" } }]), "Trip"), []);
  const bola = weapon("Bola", ["ranged-trip", "thrown-20"], 1);
  assert("ranged trip: the bonus and -2 circumstance", ctx.getManeuverWeaponModifiers(pc([bola]), "Trip").map((m) => [m.type, m.value]), [["item", 1], ["circumstance", -2]]);
  assert("other actions: none", ctx.getManeuverWeaponModifiers(pc([flail]), "Climb"), []);

  const roll = act(pc([flail]), "athletics", "Trip", [{ token: goblin, distance: 5 }]);
  assertIncludes("performSkillAction offers it", roll.modifiers.map((m) => m.name), "Flail");
}

section("What the roll carries");
{
  let roll = act(pc(), "athletics", "Trip", [{ token: goblin, distance: 5 }]);
  assert("a maneuver against one target", roll.metadata.maneuver, { action: "Trip", targetId: "goblin", targetName: "Goblin", actorId: "pc", actorName: "Valeros" });
  assert("against its Reflex DC", roll.metadata.dc, ctx.getDefenseDCForToken(goblin, "reflex", { action: { name: "Trip" } }));
  roll = act(pc(), "athletics", "Trip", []);
  assert("no target: no DC, no outcome", [roll.metadata.dc, roll.metadata.maneuver], [undefined, undefined]);
  roll = act(pc(), "athletics", "Climb", [{ token: goblin, distance: 5 }]);
  assert("an action without outcomes: none", roll.metadata.maneuver, undefined);
  roll = act(pc(), "intimidation", "Demoralize", [{ token: goblin, distance: 5 }]);
  assert("Demoralize against Will", [roll.metadata.maneuver?.action, roll.metadata.dc], ["Demoralize", ctx.getDefenseDCForToken(goblin, "will", { action: { name: "Demoralize" } })]);
}

section("Outcomes on the result card");
{
  const trip = { action: "Trip", targetId: "goblin", targetName: "Goblin", actorId: "pc", actorName: "Valeros" };
  let lines = ctx.getManeuverResultLines(trip, 2);
  assert("critical success: the text", lines[0], "**Trip:** The target falls and lands prone and takes 1d6 bludgeoning damage.");
  assertIncludes("a button that knocks the target prone", lines[1], 'withManeuverToken("goblin", "Goblin"');
  assertIncludes("with prone", lines[1], 'applyManeuverCondition(token, "Prone", 1)');
  assertIncludes("and one for the damage", lines[2], 'api.promptRoll("Trip Damage", "1d6 bludgeoning"');
  lines = ctx.getManeuverResultLines(trip, 1);
  assert("success: prone, no damage", lines.length, 2);
  lines = ctx.getManeuverResultLines(trip, -1);
  assertIncludes("critical failure: you fall prone", lines[1], 'withManeuverToken("pc", "Valeros"');
  assert("failure: nothing", ctx.getManeuverResultLines(trip, 0), []);

  const demoralize = { ...trip, action: "Demoralize" };
  lines = ctx.getManeuverResultLines(demoralize, 2);
  assertIncludes("Demoralize critical success: frightened 2", lines[2], 'applyManeuverCondition(token, "Frightened", 2)');
  assertIncludes("the button says so", lines[2], "```Apply_Frightened_2");
  assert("and the 10-minute immunity on any result", ctx.getManeuverResultLines(demoralize, 0), ["Regardless of your result, the target is temporarily immune to your attempts to Demoralize it for 10 minutes."]);
  const grapple = ctx.getManeuverResultLines({ ...trip, action: "Grapple" }, 1);
  assertIncludes("Grapple: grabbed", grapple[1], '"Grabbed"');
  const feint = ctx.getManeuverResultLines({ ...trip, action: "Feint" }, 2);
  assert("Feint: text only (off-guard only against you)", feint.length, 1);
  assert("an unknown action: nothing", ctx.getManeuverResultLines({ ...trip, action: "Climb" }, 2), []);

  const card = (total, d20) => runHandler("skill.js", { roll: { dice: [{ type: 20, value: d20 }], total, metadata: { dc: 17, rollName: "Athletics: Trip", maneuver: trip } } });
  assertIncludes("skill.js shows the outcome", card(27, 15), "**Trip:** The target falls and lands prone and takes 1d6 bludgeoning damage.");
  assertIncludes("with its buttons", card(20, 10), "```Apply_Prone");
  assertNotIncludes("a failure shows no outcome", [card(14, 10)], "Trip:");
  assertNotIncludes("without a maneuver, unchanged", [runHandler("skill.js", { roll: { dice: [{ type: 20, value: 15 }], total: 20, metadata: { dc: 17 } } })], "Apply_");
}

section("The buttons");
{
  const added = [];
  ctx.api.addEffects = (names, token) => added.push([names, token?._id]);
  let notices = [];
  ctx.api.showNotification = (message) => notices.push(message);
  const goblinToken = { ...goblin, _id: "goblin-token", recordId: "goblin" };
  const lines = ctx.getManeuverResultLines({ action: "Demoralize", targetId: "goblin-token", targetName: "Goblin", actorId: "pc", actorName: "Valeros" }, 2);
  const code = buttonCode(lines.join("\n"), "Apply_Frightened_2");
  ctx.api.getSelectedOrDroppedToken = () => [{ token: goblinToken }];
  ctx.record = null;
  new vm.Script(code).runInContext(ctx);
  assert("frightened 2 on the selected target, in one gain", added, [[["Frightened", "Frightened"], "goblin-token"]]);
  added.length = 0;
  ctx.api.getSelectedOrDroppedToken = () => [{ token: { _id: "someone-else" } }];
  new vm.Script(code).runInContext(ctx);
  assert("another token selected: nothing changes", [added.length, notices[0]], [0, "Select Goblin's token, then click again."]);
  const pcToken = { _id: "pc-token", recordId: "pc", effects: [], effectIds: [], data: {} };
  ctx.api.getSelectedOrDroppedToken = () => [{ token: pcToken }];
  const self = buttonCode(ctx.getManeuverResultLines({ action: "Trip", targetId: "goblin", targetName: "Goblin", actorId: "pc", actorName: "Valeros" }, -1).join("\n"), "Apply_Prone");
  new vm.Script(self).runInContext(ctx);
  assert("a character's token is matched by its record", added, [[["Prone"], "pc-token"]]);
  added.length = 0;
  const prone = { _id: "prone", name: "Prone", stackable: false, rules: [] };
  ctx.api.getSelectedOrDroppedToken = () => [{ token: { ...pcToken, effects: [prone], effectIds: ["prone"] } }];
  new vm.Script(self).runInContext(ctx);
  assert("already prone: not again", added, []);
}

section("Review fixes: names with an apostrophe, critical results, ABP");
{
  // Every button parses, whatever the name holds
  const parses = (text) => {
    const bodies = [...text.matchAll(/```[A-Za-z_0-9]+\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    return bodies.length > 0 && bodies.every((code) => {
      try {
        new vm.Script(code);
        return true;
      } catch (e) {
        return false;
      }
    });
  };
  const odd = { action: "Trip", targetId: "t'1", targetName: "Ta'lir the \"Bold\"", actorId: "pc", actorName: "O'Brien" };
  assert("maneuver buttons parse with Ta'lir and O'Brien", [2, 1, -1].every((degree) => parses(ctx.getManeuverResultLines(odd, degree).join("\n"))), true);
  const talir = { _id: "t'1", name: "Ta'lir", recordType: "characters", data: {} };
  assert("dying.js's buttons too", parses(ctx.getChatButton("Heroic_Recovery", talir, "heroicRecovery(token)")), true);

  const m = { action: "Tumble Through", targetId: "goblin", targetName: "Goblin", actorId: "pc", actorName: "Valeros" };
  assert("Tumble Through, critical failure: the failure text", ctx.getManeuverResultLines(m, -1), ctx.getManeuverResultLines(m, 0));
  assert("critical success: the success text", ctx.getManeuverResultLines(m, 2), ctx.getManeuverResultLines(m, 1));
  const diversion = { ...m, action: "Create a Diversion" };
  assert("Create a Diversion, critical failure: the failure text", ctx.getManeuverResultLines(diversion, -1)[0].includes("aware you were trying to trick them"), true);
  assert("Trip keeps its own critical failure", ctx.getManeuverResultLines({ ...m, action: "Trip" }, -1)[0], "**Trip:** You lose your balance and fall and land prone.");
  assert("Demoralize, critical failure: only the immunity line", ctx.getManeuverResultLines({ ...m, action: "Demoralize" }, -1).length, 1);

  const savedAbp = ctx.getAbpBonuses;
  ctx.getAbpBonuses = () => ({ attack: 2 });
  const flail = weapon("Flail", ["trip"], 0);
  assert("ABP: the attack potency, untyped, with no rune", ctx.getManeuverWeaponModifiers(pc([flail]), "Trip").map((mod) => [mod.name, mod.type, mod.value]), [["Attack Potency +2 (Flail)", "", 2]]);
  assert("ABP: still needs a weapon with the trait", ctx.getManeuverWeaponModifiers(pc([weapon("Sword", [], 0)]), "Trip"), []);
  ctx.getAbpBonuses = savedAbp;
}

section("Escape: the grabber's listed Escape DC, or its Athletics DC");
{
  const npc = (actions, extra = {}) => ({ _id: "ooze", name: "Ooze", recordType: "npcs", identified: true, effects: [], effectIds: [], data: { level: 3, traits: [], actions, skills: [{ name: "Athletics", data: { mod: 9 } }], ...extra } });
  const engulf = { name: "Engulf", data: { description: "<p>The creature is grabbed (Escape DC 25).</p>" } };
  const swallow = { name: "Swallow Whole", data: { description: "<p>... [[/act escape dc=28]], Rupture 15</p>" } };
  assert("listed Escape DCs, highest first", ctx.getListedEscapeDCs(npc([engulf, swallow])), [28, 25]);
  assert("\"DC 23 to Escape\" counts too", ctx.getListedEscapeDCs(npc([{ name: "Web", data: { description: "It can attempt a DC 23 to Escape." } }])), [23]);
  assert("a listed DC wins", ctx.getEscapeDC(npc([engulf])), 25);
  assert("none listed: the Athletics DC (10 + 9)", ctx.getEscapeDC(npc([])), 19);
  assert("an NPC without Athletics: its Strength", ctx.getEscapeDC(npc([], { skills: [], str: 4 })), 14);
  assert("a character: 10 + athleticsMod", ctx.getEscapeDC(pc([], { athleticsMod: 7 })), 17);
  assert("no grabber: no DC", ctx.getEscapeDC(null), null);

  const roll = act(pc(), "athletics", "Escape", [{ token: npc([engulf]), distance: 5 }]);
  assert("Escape rolls against it", [roll.metadata.dc, roll.metadata.dcName], [25, "Escape DC"]);
  assert("with its outcomes", roll.metadata.maneuver?.action, "Escape");
  assert("Acrobatics too", act(pc(), "acrobatics", "Escape", [{ token: npc([]), distance: 5 }]).metadata.dc, 19);

  const m = { action: "Escape", targetId: "ooze", targetName: "Ooze", actorId: "pc", actorName: "Valeros" };
  const success = ctx.getManeuverResultLines(m, 1);
  assertIncludes("success: free, with a button", success[1], 'withManeuverToken("pc", "Valeros"');
  assertIncludes("that removes the conditions", success[1], "freeFromManeuvers(token)");
  assertIncludes("critical success: Stride 5 feet", ctx.getManeuverResultLines(m, 2)[0], "Stride up to 5 feet");
  assertIncludes("critical failure: no Escape until your next turn", ctx.getManeuverResultLines(m, -1)[0], "until your next turn");

  const removed = [];
  ctx.api.removeEffectById = (id, token, cb) => {
    removed.push(id);
    if (cb) cb();
  };
  const effect = (name) => ({ _id: name.toLowerCase(), name, rules: [] });
  ctx.freeFromManeuvers({ _id: "pc-token", effects: [effect("Grabbed"), effect("Restrained"), effect("Prone"), effect("Immobilized")], effectIds: ["grabbed", "restrained", "prone", "immobilized", "immobilized"] });
  assert("Get Free removes grabbed, restrained and both immobilized stacks, not prone", removed, ["grabbed", "restrained", "immobilized", "immobilized"]);
}

process.exitCode = summary();
