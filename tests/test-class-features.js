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
  assert("using it rolls the d20 and keeps it", sets, [["tok-inv", "characters", { "data.stratagem": { value: 14, round: 2, used: false } }]]);
  assertIncludes("the card shows it", line, "**Stratagem d20: 14.**");
  assert("another action: nothing", ctx.getStratagemUse({ name: "Recall Knowledge" }, token), "");

  const record = { _id: "inv", data: { stratagem: { value: 14, round: 2, used: false } } };
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
  const strike = (stratagem) => {
    const record = { _id: "inv", recordType: "characters", name: "Quinn", effects: [], effectIds: [], fields: {}, data: { level: 5, str: 0, dex: 3, int: 4, ancestries: [], classes: [], feats: [], bonusFeats: [], inventory: [rapier], stratagem } };
    const saved = { getToken: ctx.api.getToken, getTargets: ctx.api.getTargets, promptRoll: ctx.api.promptRoll, setValues: ctx.api.setValues };
    let metadata = null;
    const written = {};
    ctx.api.getToken = () => ({ _id: "tok-inv", recordType: "characters", recordId: "inv", record, data: record.data });
    ctx.api.getTargets = () => [marked()];
    ctx.api.promptRoll = (name, dice, mods, md) => (metadata = md);
    ctx.api.setValues = (values) => Object.assign(written, values);
    try {
      ctx.performAttackRoll(record, rapier, "data.inventory.0", 1);
    } finally {
      Object.assign(ctx.api, saved);
    }
    return { metadata: metadata || {}, written };
  };
  const first = strike({ value: 14, round: 2, used: false });
  assert("the first Strike against the mark takes the d20, used up in the attack's write", [first.metadata.stratagemD20, first.written["data.stratagem.used"]], [14, true]);
  const second = strike({ value: 14, round: 2, used: true });
  assert("the next one rolls as usual", [second.metadata.stratagemD20, "data.stratagem.used" in second.written], [undefined, false]);
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

// --- Thaumaturge and psychic (our Dark Archive module's records) ----------------

const PA = { _id: "pa", name: "Exploit Vulnerability (Personal Antithesis)", rules: [{ type: "tokenMark", field: "", valueType: "string", value: "exploit-vulnerability" }, { type: "weakness", field: "", valueType: "string", value: "personal-antithesis @effect.value" }] };
const MW = { _id: "mw", name: "Exploit Vulnerability (Mortal Weakness)", rules: [{ type: "tokenMark", field: "", valueType: "string", value: "exploit-vulnerability" }] };
const fireWeak = (value) => ({ name: "Weakness", data: { type: "fire", value: String(value) } });
const creature = (id, effects = [], data = {}, values = {}) => ({ _id: id, name: id === "troll" ? "Troll" : "Ogre", recordType: "npcs", identified: true, record: { name: id }, data: { level: 5, weaknesses: [], resistances: [], immunities: [], ...data }, effects, effectIds: effects.map((e) => e._id), effectValues: values });
const thaum = (data = {}) => ({ _id: "tok-thm", recordType: "characters", name: "Thea", data: { level: 6, loreSkills: [{ name: "Esoteric Lore", data: { rank: "1", mod: 9, ability: "cha" } }], ...data }, effects: [], effectIds: [] });

section("Exploit Vulnerability: the weakness and categories");
{
  const troll = creature("troll", [PA], { weaknesses: [fireWeak(10)] }, { pa: { value: 5, tokenName: "Thea" } });
  assert("Personal Antithesis: weakness 5 from the effect's value", ctx.getIWR(troll).weaknesses["personal-antithesis"]?.value, 5);
  assert("the Strike against it: magical and personal-antithesis", ctx.getExploitDamageCategories({ token: troll }, thaum(), null), ["magical", "personal-antithesis"]);
  const mortal = creature("troll", [MW], { weaknesses: [fireWeak(10)] });
  assert("Mortal Weakness: its highest weakness (fire)", ctx.getExploitDamageCategories({ token: mortal }, thaum(), null), ["magical", "fire"]);
  assert("not exploited: nothing", ctx.getExploitDamageCategories({ token: creature("ogre") }, thaum(), null), []);
  assert("the highest weakness, personal antithesis left out", ctx.getHighestWeakness(troll), { type: "fire", value: 10 });
}

section("Exploit Vulnerability: the check");
{
  let rolled = null;
  const realRollSkill = ctx.rollSkill;
  ctx.rollSkill = (token, skill, dc, isLore, mod, rank, ability, isMacro, isInit, group, extra) => (rolled = { skill, dc, isLore, mod, rank, ability, extra });
  const realTargets = ctx.api.getTargets;
  ctx.api.getTargets = () => [];
  assertIncludes("no target: says so", ctx.getExploitVulnerabilityUse({ name: "Exploit Vulnerability" }, thaum()), "Target the creature first");
  const troll = creature("troll", [], { weaknesses: [fireWeak(10)] });
  ctx.api.getTargets = () => [{ token: troll }];
  const line = ctx.getExploitVulnerabilityUse({ name: "Exploit Vulnerability" }, thaum());
  assert("Esoteric Lore (Charisma, +9) against the level 5 DC", [rolled.skill, rolled.dc, rolled.isLore, rolled.mod, rolled.rank, rolled.ability], ["Esoteric Lore", 20, true, 9, 1, "cha"]);
  assertIncludes("the card", line, "Esoteric Lore against DC 20");
  const notes = rolled.extra.targetNotes;
  assertIncludes("a critical success: everything, for the GM", notes[0].text, "[gm]Weaknesses: fire 10. Resistances: none. Immunities: none.[/gm]");
  assertIncludes("... both buttons", notes[0].text, "Exploit_Mortal_Weakness");
  assertIncludes("a success: the highest weakness", notes[1].text, "[gm]Highest weakness: fire 10.[/gm]");
  assert("a failure: personal antithesis only", [notes[2].text.includes("Exploit_Personal_Antithesis"), notes[2].text.includes("Exploit_Mortal_Weakness")], [true, false]);
  assertIncludes("a critical failure: off-guard", notes[3].text, 'api.addEffect("Off-Guard"');
  ctx.rollSkill = realRollSkill;
  ctx.api.getTargets = realTargets;
}

section("Exploit Vulnerability: applying it");
{
  const calls = [];
  const realAdd = ctx.api.addEffect;
  const realRemove = ctx.api.removeEffectById;
  const realFind = ctx.findSceneToken;
  const ogre = creature("ogre", [MW], {}, { mw: { tokenId: "tok-thm" } });
  const troll = creature("troll");
  const t = thaum({ exploit: { targetId: "ogre", mode: "mortal" } });
  ctx.findSceneToken = (id) => ({ "tok-thm": t, ogre, troll })[id];
  ctx.api.addEffect = (name, token, duration, value) => calls.push(["add", name, token._id, value]);
  ctx.api.removeEffectById = (id, token, cb) => {
    calls.push(["remove", id, token._id]);
    if (cb) cb();
  };
  sets = [];
  state.messages = [];
  ctx.exploitVulnerability("tok-thm", "troll", "antithesis");
  assert(
    "the last exploit comes off the ogre, then the troll gets weakness 2 + 3",
    calls,
    [["remove", "mw", "ogre"], ["add", "Exploit Vulnerability (Personal Antithesis)", "troll", { value: 5, tokenId: "tok-thm" }]],
  );
  assert("... and the thaumaturge keeps it", sets, [["tok-thm", "characters", { "data.exploit": { targetId: "troll", mode: "antithesis" } }]]);
  assertIncludes("the card", state.messages[0], "it has weakness 5 to their unarmed and weapon Strikes");
  ctx.api.addEffect = realAdd;
  ctx.api.removeEffectById = realRemove;
  ctx.findSceneToken = realFind;
}

section("Esoteric Lore keeps its Charisma");
{
  const feature = { name: "Esoteric Lore", data: { type: "classfeature", level: 1, proficiencies: [{ name: "Proficiency", data: { name: "esoteric lore", rank: "1", ability: "cha" } }] } };
  const record = { _id: "c1", recordType: "characters", data: { level: 1, cha: 4, int: 0, classes: [{ data: {} }], feats: [], bonusFeats: [], features: [feature], loreSkills: [] } };
  const values = {};
  ctx.updateProficiencies(record, values);
  const lore = (values["data.loreSkills"] || []).find((l) => l.name === "Esoteric Lore");
  assert("the granted lore skill uses Charisma", [lore?.data?.rank, lore?.data?.ability], ["1", "cha"]);
}

section("Unleash Psyche");
{
  const added = [];
  const realAdd = ctx.api.addEffect;
  ctx.api.addEffect = (name, token) => added.push([name, token._id]);
  const psychic = (data = {}, effects = []) => ({ _id: "tok-psy", recordType: "characters", name: "Pia", data: { level: 3, ...data }, effects, effectIds: effects.map((e) => e._id) });
  assertIncludes("using it adds the effect", ctx.getUnleashPsycheUse({ name: "Unleash Psyche" }, psychic()), "unleashed for 2 rounds");
  assert("... to the psychic", added, [["Unleash Psyche", "tok-psy"]]);
  added.length = 0;
  const stupefied = { _id: "stu", name: "Stupefied", rules: [] };
  assertIncludes("stupefied: it can't", ctx.getUnleashPsycheUse({ name: "Unleash Psyche" }, psychic({}, [stupefied])), "You're stupefied");
  assertIncludes("still waiting: it can't", ctx.getUnleashPsycheUse({ name: "Unleash Psyche" }, psychic({ recharges: [{ name: "Unleash Psyche", readyRound: 4 }] })), "until round 4");
  assert("... and neither adds it", added, []);
  ctx.api.addEffect = realAdd;

  const ended = ctx.getPsycheSubsidesMessage(psychic(), [{ name: "Unleash Psyche", oldCount: 1, newCount: 0 }]);
  assertIncludes("it ends: the card", ended, "**Pia's psyche subsides:** stupefied 1 for 2 rounds");
  assertIncludes("... with the stupefied button", ended, 'api.addEffect("Stupefied", token, { value: 2, unit: "rounds" })');
  assertIncludes("... and the wait", ended, 'startRecharge(token, "Unleash Psyche", "2")');
  assert("added, or another effect: nothing", [ctx.getPsycheSubsidesMessage(psychic(), [{ name: "Unleash Psyche", oldCount: 0, newCount: 1 }]), ctx.getPsycheSubsidesMessage(psychic(), [{ name: "Frightened", oldCount: 1, newCount: 0 }])], ["", ""]);
}

section("Amps");
{
  const realMax = ctx.getFocusPoolMax;
  const realSpent = ctx.getFocusPointsSpent;
  const realValues = ctx.getFocusPoolValues;
  ctx.getFocusPoolMax = () => 2;
  ctx.getFocusPoolValues = (record, spent) => ({ "data.focusPool": spent });
  ctx.getFocusPointsSpent = () => 1;
  assert("a character with a point left spends it", ctx.getAmpFocusValues({ recordType: "characters" }, {}, "data.spells.0"), { "data.focusPool": 2 });
  ctx.getFocusPointsSpent = () => 2;
  assert("... none left: null", ctx.getAmpFocusValues({ recordType: "characters" }, {}, "data.spells.0"), null);
  assert("an NPC spends its entry's", ctx.getAmpFocusValues({ recordType: "npcs" }, { data: { focusPoolMax: 1, focusPool: 0 } }, "data.spells.0"), { "data.spells.0.data.focusPool": 1 });
  ctx.getFocusPoolMax = realMax;
  ctx.getFocusPointsSpent = realSpent;
  ctx.getFocusPoolValues = realValues;
}

process.exitCode = summary() > 0 ? 1 : 0;
