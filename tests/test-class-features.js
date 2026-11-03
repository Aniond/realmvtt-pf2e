// Tests for class features (class-extras.js): Devise a Stratagem's d20, the
// inventor's Overdrive and unstable actions.
// Run: node tests/test-class-features.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const state = ctx.__state;

let sets = [];
ctx.api.setValuesOnTokenById = (id, type, values, cb) => {
  sets.push([id, type, values]);
  if (cb) cb();
};
let d20s = [];
ctx.api.rollInstant = () => ({ total: d20s.shift() });
const variables = { pf2eEncounter: { round: 2, participants: [] } };
ctx.api.getCampaignVariable = (key) => variables[key];

function runHandler(file, data) {
  state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return state.messages.join("\n");
}

const investigator = (data = {}) => ({ _id: "tok-inv", recordType: "characters", recordId: "inv", name: "Quinn", data: { level: 5, ...data }, record: { _id: "inv", name: "Quinn" }, effects: [], effectIds: [] });
const STRATAGEM = { _id: "dsg", name: "Devise a Stratagem", rules: [{ type: "tokenMark", field: "", valueType: "string", value: "devise-a-stratagem" }] };
const marked = (by = "tok-inv") => ({ token: { _id: "gob", name: "Goblin", recordType: "npcs", data: { ac: 18, level: 1 }, record: { name: "Goblin" }, identified: true, effects: [STRATAGEM], effectIds: ["dsg"], effectValues: { dsg: { tokenId: by } } } });

section("Devise a Stratagem");
{
  sets = [];
  d20s = [14];
  const token = investigator();
  const line = ctx.getStratagemUse({ name: "Devise a Stratagem" }, token);
  assert("using it rolls the d20 and keeps it", sets, [["tok-inv", "characters", { "data.stratagem": { value: 14, used: false } }]]);
  assertIncludes("the card shows it", line, "**Stratagem d20: 14.**");
  assert("another action: nothing", ctx.getStratagemUse({ name: "Recall Knowledge" }, token), "");

  const record = { _id: "inv", data: { stratagem: { value: 14, used: false } } };
  assert("a Strike against the marked creature takes it", ctx.getStratagemD20(record, marked(), token), 14);
  assert("... marked by the record's id too", ctx.getStratagemD20(record, marked("inv"), token), 14);
  assert("... not after it's used", ctx.getStratagemD20({ data: { stratagem: { value: 14, used: true } } }, marked(), token), null);
  assert("... not against another creature", ctx.getStratagemD20(record, { token: { _id: "orc", effects: [] } }, token), null);
  assert("... not against someone else's mark", ctx.getStratagemD20(record, marked("tok-other"), token), null);
  assert("... nor without a stratagem", ctx.getStratagemD20({ data: {} }, marked(), token), null);

  sets = [];
  ctx.clearStratagem(investigator({ stratagem: { value: 14, used: true } }));
  ctx.clearStratagem(investigator());
  assert("it ends at their next turn's start (only written when there is one)", sets, [["tok-inv", "characters", { "data.stratagem": null }]]);
}

section("The Strike takes the d20");
{
  const hit = runHandler("attack.js", { roll: { dice: [{ type: 20, value: 5 }], total: 17, metadata: { dc: 20, attack: "Rapier", traits: [], damage: "1d6 piercing", stratagemD20: 14 } } });
  assertIncludes("the card says so", hit, "Devise a Stratagem: the d20 is 14 (rolled 5).");
  assertIncludes("... and 14 + 12 = 26 hits DC 20", hit, "HIT[/color] [gm]vs AC 20 (+6)");
  const crit = runHandler("attack.js", { roll: { dice: [{ type: 20, value: 2 }], total: 14, metadata: { dc: 30, attack: "Rapier", traits: [], damage: "1d6 piercing", stratagemD20: 20 } } });
  assertIncludes("a stratagem 20 is a natural 20: 32 against DC 30 is a critical hit", crit, "CRITICAL");
  const plain = runHandler("attack.js", { roll: { dice: [{ type: 20, value: 5 }], total: 17, metadata: { dc: 20, attack: "Rapier", traits: [], damage: "1d6 piercing" } } });
  assertNotIncludes("no stratagem: as before", plain, "Devise a Stratagem");
}

section("The Strike: from the sheet");
{
  const rapier = { _id: "w1", name: "Rapier", recordType: "items", data: { type: "weapon", carried: "equipped", itemCategory: "martial", group: "sword", traits: ["Finesse"], usage: "held-in-one-hand", range: 0, damage: { dice: 1, die: "d6", damageType: "piercing" }, runes: { potency: 0, striking: 0, property: [] } } };
  const longsword = { ...rapier, _id: "w2", name: "Longsword", data: { ...rapier.data, traits: ["Versatile-P"], damage: { dice: 1, die: "d8", damageType: "slashing" } } };
  const shortbow = { ...rapier, _id: "w3", name: "Shortbow", data: { ...rapier.data, traits: ["Deadly-D10"], range: 60, group: "bow", ammo: 10 } };
  const strike = (stratagem, weapon = rapier) => {
    const record = { _id: "inv", recordType: "characters", name: "Quinn", effects: [], effectIds: [], fields: {}, data: { level: 5, str: 0, dex: 3, int: 4, ancestries: [], classes: [], feats: [], bonusFeats: [], inventory: [weapon], stratagem } };
    const saved = { getToken: ctx.api.getToken, getTargets: ctx.api.getTargets, promptRoll: ctx.api.promptRoll, setValues: ctx.api.setValues };
    let metadata = null;
    const written = {};
    ctx.api.getToken = () => ({ _id: "tok-inv", recordType: "characters", recordId: "inv", record, data: record.data });
    ctx.api.getTargets = () => [marked()];
    ctx.api.promptRoll = (name, dice, mods, md) => (metadata = md);
    ctx.api.setValues = (values) => Object.assign(written, values);
    try {
      ctx.performAttackRoll(record, weapon, "data.inventory.0", 1);
    } finally {
      Object.assign(ctx.api, saved);
    }
    return { metadata: metadata || {}, written };
  };
  const first = strike({ value: 14, used: false });
  assert("the first Strike against the mark takes the d20, used up in the attack's write", [first.metadata.stratagemD20, first.written["data.stratagem.used"]], [14, true]);
  const second = strike({ value: 14, used: true });
  assert("the next one rolls as usual", [second.metadata.stratagemD20, "data.stratagem.used" in second.written], [undefined, false]);
  const melee = strike({ value: 14, used: false }, longsword);
  assert("a longsword (not agile or finesse): rolls as usual, and the stratagem isn't used up", [melee.metadata.stratagemD20, "data.stratagem.used" in melee.written], [undefined, false]);
  assert("a shortbow (ranged, not thrown) takes it", strike({ value: 14, used: false }, shortbow).metadata.stratagemD20, 14);
  assert(
    "which weapons can: agile, finesse, or ranged and not thrown",
    [ctx.isStratagemWeapon({ data: { traits: ["Agile"] } }, true, false), ctx.isStratagemWeapon({ data: { traits: [] } }, true, false), ctx.isStratagemWeapon({ data: { traits: [] } }, false, false), ctx.isStratagemWeapon({ data: { traits: ["Thrown-20"] } }, false, true)],
    [true, false, true, false],
  );
}

section("Overdrive");
{
  let rolled = null;
  const realRollSkill = ctx.rollSkill;
  ctx.rollSkill = (token, skill, dc, isLore, a, b, c, isMacro, isInit, group, extra) => (rolled = { skill, dc, extra });
  const inventor = { _id: "tok-ivr", recordType: "characters", name: "Ivo", data: { level: 5 }, effects: [], effectIds: [] };
  const line = ctx.getOverdriveUse({ name: "Overdrive" }, inventor);
  assert("using it rolls Crafting against the standard DC for level 5", [rolled.skill, rolled.dc, rolled.extra.action], ["crafting", 20, "Overdrive"]);
  assertIncludes("the card says the DC", line, "Crafting against DC 20, the standard DC for level 5.");
  const notes = rolled.extra.targetNotes;
  assert("a note for each result", notes.map((n) => n.outcome[0]), [2, 1, 0, -1]);
  assertIncludes("a success and a critical success: the 1-minute lockout when it ends", notes[1].text + notes[0].text, "When it ends, you can't use Overdrive for 1 minute.");
  assertIncludes("a critical success applies the module's effect", notes[0].text, "Apply_Overdrive_Critical_Success\n");
  assertIncludes("... with the button", notes[0].text, 'api.addEffect("Overdrive (Critical Success)", token)');
  assertIncludes("a critical failure: 3 fire damage (half of 5, up)", notes[3].text, "Take_3_Fire_Damage");
  assertIncludes("... and the 1d4-round recharge", notes[3].text, 'startRecharge(token, "Overdrive", "1d4")');
  assert("another action: nothing", ctx.getOverdriveUse({ name: "Explode" }, inventor), "");
  ctx.rollSkill = realRollSkill;
}

section("Unstable");
{
  assert("DC 15, 13 legendary in Crafting", [ctx.getUnstableDC({ data: { crafting: "3" } }), ctx.getUnstableDC({ data: { crafting: "4" } })], [15, 13]);
  assert("15 or more: it holds", ctx.getUnstableResult(15, 15, 5), { degree: 1, text: "it holds." });
  assertIncludes("under 15: it malfunctions", ctx.getUnstableResult(9, 15, 5).text, "can't be used for unstable actions until you spend 10 minutes retuning it.");
  assertIncludes("5 or less: and 2 fire damage at level 5", ctx.getUnstableResult(5, 15, 5).text, "You take 2 fire damage");
  d20s = [12];
  const line = ctx.getUnstableUse({ name: "Explode", data: { traits: ["Fire", "Inventor", "Manipulate", "Unstable"] } }, { _id: "t", data: { level: 5, crafting: "2" } });
  assertIncludes("an unstable action rolls the check as it's used", line, "**Unstable (DC 15 flat check): [color=red]12[/color]**");
  assert("not unstable: nothing", ctx.getUnstableUse({ name: "Overdrive", data: { traits: ["Inventor"] } }, { _id: "t", data: {} }), "");
}

process.exitCode = summary() > 0 ? 1 : 0;
