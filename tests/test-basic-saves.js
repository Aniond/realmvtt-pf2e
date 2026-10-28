// Tests for basic saves applied per target (rollhandlers/basic-saves.js):
// save.js keeps each save's result on the saver's token, and the damage
// card's Apply by Saves applies the damage to each selected creature by its
// own save: none, half, full or double.
// Run: node tests/test-basic-saves.js (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
// spells.js shares the sheet's scope with common.js at runtime
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// --- helpers ----------------------------------------------------------------

let sets = [];
ctx.api.setValuesOnTokenById = (id, recordType, values, cb) => {
  sets.push([id, recordType, values]);
  if (cb) cb();
};
let notices = [];
ctx.api.showNotification = (message) => notices.push(message);

function runHandler(file, data) {
  ctx.__state.messages = [];
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return ctx.__state.messages.join("\n");
}

// A save roll's result: total against the DC, with a natural d20
const saveRoll = (natural, total, metadata) => ({
  roll: { dice: [{ type: 20, value: natural }], total, metadata: { rollName: "Reflex Save", saveType: "reflex", dc: 20, ...metadata } },
});

const token = (id, name, data = {}) => ({ _id: id, name, recordType: "characters", recordId: `rec-${id}`, record: { name }, data });
const recent = (degree, saveType = "reflex", ago = 0) => ({ degree, saveType, dc: 20, time: Date.now() - ago });

// --- tests ------------------------------------------------------------------

section("Which token a save is kept on");
{
  const kyra = token("tok-kyra", "Kyra");
  assert("a token: itself", ctx.getSaverTokenRef(kyra), { id: "tok-kyra", recordType: "characters" });
  const sheet = { _id: kyra.recordId, recordType: "characters", data: {} };
  ctx.api.getToken = () => kyra;
  assert("a character sheet: its token", ctx.getSaverTokenRef(sheet), { id: "tok-kyra", recordType: "characters" });
  ctx.api.getToken = () => token("tok-other", "Other");
  assert("another creature's token: none", ctx.getSaverTokenRef(sheet), null);
  ctx.api.getToken = () => null;
  assert("no token: none", ctx.getSaverTokenRef(sheet), null);
}

section("rollSave carries the saver and whether the save is basic");
{
  let metadata = null;
  const saved = ctx.api.promptRoll;
  ctx.api.promptRoll = (name, dice, modifiers, meta) => (metadata = meta);
  const kyra = token("tok-kyra", "Kyra", { reflexMod: 9 });
  ctx.rollSave(kyra, "reflex", 22, true, false, { basic: true });
  assert("the saver's token", [metadata.saverTokenId, metadata.saverRecordType], ["tok-kyra", "characters"]);
  assert("a basic save", metadata.basicSave, true);
  ctx.rollSave(kyra, "reflex", 22, true, false, {});
  assert("not basic: no flag", metadata.basicSave, undefined);
  // An NPC ability's save button, as Sean's converter writes it
  ctx.api.getSelectedOrDroppedToken = () => [kyra];
  ctx.rollSavingThrow("reflex", 28, { basic: true });
  assert("rollSavingThrow passes basic on", [metadata.basicSave, metadata.dc], [true, 28]);
  ctx.api.getSelectedOrDroppedToken = () => [];
  ctx.api.promptRoll = saved;

  const macro = ctx.getSaveMacro("reflex", 22, true, true, ["Fire"], true);
  assertIncludes("the save button passes basic", macro, '{"traits":["Fire"],"basic":true}');
  assertIncludes("not basic: as before", ctx.getSaveMacro("reflex", 22, true, true, ["Fire"]), '{"traits":["Fire"]});');
}

section("save.js keeps the result and says what a basic save takes");
{
  sets = [];
  let card = runHandler("save.js", saveRoll(12, 25, { saverTokenId: "tok-kyra", saverRecordType: "characters", basicSave: true }));
  assert("the result goes on the saver's token", sets.map(([id, type, v]) => [id, type, v["data.lastSave"].degree, v["data.lastSave"].saveType, v["data.lastSave"].dc]), [["tok-kyra", "characters", 1, "reflex", 20]]);
  assertIncludes("a success: half", card, "**Basic save:** half damage.");
  card = runHandler("save.js", saveRoll(15, 31, { saverTokenId: "tok-kyra", saverRecordType: "characters", basicSave: true }));
  assertIncludes("a critical success: none", card, "**Basic save:** no damage.");
  card = runHandler("save.js", saveRoll(1, 15, { saverTokenId: "tok-kyra", saverRecordType: "characters", basicSave: true }));
  assertIncludes("a natural 1 failure: critical failure, double", card, "**Basic save:** double damage.");
  card = runHandler("save.js", saveRoll(8, 14, { saverTokenId: "tok-kyra", saverRecordType: "characters" }));
  assertNotIncludes("not basic: no line", card, "Basic save");
  sets = [];
  runHandler("save.js", saveRoll(8, 14, {}));
  assert("no saver: nothing kept", sets, []);
  runHandler("save.js", { roll: { dice: [{ type: 20, value: 8 }], total: 14, metadata: { rollName: "Reflex Save", saverTokenId: "tok-kyra" } } });
  assert("no DC: nothing kept", sets, []);
}

section("The damage card's Apply by Saves");
{
  const damage = (metadata) => ({ roll: { dice: [{ type: 6, value: 4 }], total: 20, types: [{ type: "fire", value: 20 }], metadata: { damageType: "fire", ...metadata } } });
  assertIncludes("a basic save spell's damage", runHandler("damage.js", damage({ isSpell: true, basicSave: { saveType: "reflex" } })), "```Apply_by_Saves");
  assertIncludes("an ability's basic save damage", runHandler("damage.js", damage({ basicSave: { saveType: "reflex" } })), "Apply_by_Saves");
  assertNotIncludes("a Strike's damage: no", runHandler("damage.js", damage({ attack: "Longsword" })), "Apply_by_Saves");
  assertNotIncludes("a spell without a basic save: no", runHandler("damage.js", damage({ isSpell: true, basicSave: null })), "Apply_by_Saves");
  assertNotIncludes("persistent damage: no", runHandler("damage.js", damage({ basicSave: { saveType: "reflex" }, isPersistant: true })), "Apply_by_Saves");
  assertNotIncludes("other damage: no", runHandler("damage.js", damage({ rollName: "2d12 + 4 bludgeoning Damage" })), "Apply_by_Saves");

  // executeDamageMacro takes the basic save from its context
  let metadata = null;
  const saved = ctx.api.promptRoll;
  ctx.api.promptRoll = (name, dice, modifiers, meta) => (metadata = meta);
  ctx.executeDamageMacro("8d8 bludgeoning", "standard", "Avalanche Breath", { basicSave: { saveType: "reflex" } });
  assert("against a basic save: named on the roll", metadata.basicSave, { saveType: "reflex" });
  ctx.executeDamageMacro("2d12+4 bludgeoning", "standard", "Swallow Whole");
  assert("no basic save (an older import, or none): no button", metadata.basicSave, undefined);
  ctx.executeDamageMacro("2d8 healing", "healing", "Heal", { basicSave: { saveType: "reflex" } });
  assert("healing: no", metadata.basicSave, undefined);
  ctx.api.promptRoll = saved;

  // An NPC ability's description: its damage buttons get the basic save
  // when its save button is basic (Sean's converter)
  const breath = { _id: "act-breath", recordType: "actions", name: "Avalanche Breath", data: {} };
  const withBasic = "deals ```8d8_Damage\nexecuteDamageMacro('8d8 bludgeoning', 'standard', '8d8 bludgeoning Damage')\n``` in a cone (```Reflex_Save\nrollSavingThrow('reflex', 28, { basic: true });\n``` save)";
  const updated = ctx.updateDamageMacros(withBasic, { item: breath, creature: { _id: "npc", recordType: "npcs", data: {} } });
  assertIncludes("the damage button gets the save type and a use id", updated, `executeDamageMacro('8d8 bludgeoning', 'standard', '8d8 bludgeoning Damage', {"basicSave":{"saveType":"reflex","useId":"`);
  const jsonFlag = withBasic.replace("{ basic: true }", '{"basic":true}');
  assertIncludes("JSON-style flag too", ctx.updateDamageMacros(jsonFlag, { item: breath, creature: { _id: "npc", recordType: "npcs", data: {} } }), '"basicSave":{"saveType":"reflex","useId":');
  // A basic save without a DC (Sean's review: @Check[fortitude|against:spell|basic])
  const noDC = "```Damage\nexecuteDamageMacro('6d6 fire', 'standard', '6d6 fire Damage')\n``` (```Fortitude_Save\nrollSavingThrow('fortitude', undefined, { basic: true });\n```)";
  assertIncludes("no DC: still basic", ctx.updateDamageMacros(noDC, { item: breath, creature: { _id: "npc", recordType: "npcs", data: {} } }), '"basicSave":{"saveType":"fortitude","useId":');
  // Two damage parts under one save (Kuribu's Blessed Aspect): one use id
  const twoParts = "```A\nexecuteDamageMacro('2d10 sonic', 'standard', '2d10 sonic Damage')\n``` and ```B\nexecuteDamageMacro('4d6 bludgeoning', 'standard', '4d6 bludgeoning Damage')\n``` (```Reflex_Save\nrollSavingThrow('reflex', 30, { basic: true });\n```)";
  const ids = [...ctx.updateDamageMacros(twoParts, { item: breath, creature: { _id: "npc", recordType: "npcs", data: {} } }).matchAll(/"useId":"([^"]+)"/g)].map((m) => m[1]);
  assert("both damage buttons share the use's id", [ids.length, ids[0] === ids[1]], [2, true]);
  const again = [...ctx.updateDamageMacros(twoParts, { item: breath, creature: { _id: "npc", recordType: "npcs", data: {} } }).matchAll(/"useId":"([^"]+)"/g)].map((m) => m[1]);
  assert("the next use: a new id", again[0] !== ids[0], true);
  const older = withBasic.replace(", { basic: true }", "");
  assertIncludes("an older import: unchanged", ctx.updateDamageMacros(older, { item: breath, creature: { _id: "npc", recordType: "npcs", data: {} } }), "executeDamageMacro('8d8 bludgeoning', 'standard', '8d8 bludgeoning Damage')\n");
  assert("no basic save in the description: none", ctx.getDescriptionBasicSave("rollSavingThrow('will', 26);", breath), null);
  assert("a spell's Basic box", ctx.getDescriptionBasicSave("", { recordType: "spells", data: { defense: { save: { statistic: "Reflex", basic: true } } } }).saveType, "reflex");

  // A spell's damage button names the save
  const fireball = { _id: "fb", name: "Fireball", recordType: "spells", data: { level: 3, traits: ["Fire"], defense: { save: { statistic: "reflex", basic: true } }, damage: [{ data: { formula: "6d6", type: "fire" } }] } };
  const caster = { _id: "pc", recordType: "characters", data: { level: 5 } };
  ctx.calculateSpellDamage = () => ({ hasDamage: true, damageString: "6d6 fire", persistentDamage: "", splashDamageValue: 0, splashDamageType: "" });
  assertIncludes("a basic save spell's damage names the save, with a use id per cast", ctx.getSpellDamageMacro(caster, fireball, "data.spells.0.data.spells3.0"), 'basicSave: {"saveType":"reflex","useId":"');
  const notBasic = { ...fireball, data: { ...fireball.data, defense: { save: { statistic: "reflex", basic: false } } } };
  assertIncludes("not basic: null", ctx.getSpellDamageMacro(caster, notBasic, "data.spells.0.data.spells3.0"), "basicSave: null");
}

section("Applying by each creature's save");
{
  const applied = [];
  const savedApply = ctx.applyDamage;
  ctx.applyDamage = (target, roll, half) => applied.push([target._id, half, roll.metadata.critical === true]);
  const roll = { total: 20, types: [{ type: "fire", value: 20 }], metadata: { attack: "Fireball", isSpell: true, basicSave: { saveType: "reflex", useId: "use-1" } } };
  const creatures = [
    token("a", "Amiri", { lastSave: recent(2) }),
    token("b", "Kyra", { lastSave: recent(1) }),
    token("c", "Seelah", { lastSave: recent(0) }),
    token("d", "Ezren", { lastSave: recent(-1) }),
    token("e", "Valeros", {}),
    token("f", "Merisiel", { lastSave: recent(1, "reflex", 11 * 60 * 1000) }),
    token("g", "Harsk", { lastSave: recent(1, "fortitude") }),
  ];
  ctx.api.getSelectedOrDroppedToken = () => creatures;
  sets = [];
  ctx.__state.messages = [];
  ctx.applyDamageBySaves(roll);
  assert("success: half; failure: full; critical failure: double; critical success: nothing", applied, [["b", true, false], ["c", false, false], ["d", false, true]]);
  assert("each save used is marked with the use", sets.map(([id, , v]) => [id, v["data.lastSave"].usedBy, v["data.lastSave"].degree]), [["a", "use-1", 2], ["b", "use-1", 1], ["c", "use-1", 0], ["d", "use-1", -1]]);
  const summaryText = ctx.__state.messages.join("\n");
  assertIncludes("chat says what each took", summaryText, "**Fireball: applied by saves**\n- Amiri: Reflex critical success, no damage\n- Kyra: Reflex success, half damage\n- Seelah: Reflex failure, full damage\n- Ezren: Reflex critical failure, double damage");
  assertIncludes("no save: nothing applied", summaryText, "- Valeros: no Reflex save rolled, nothing applied");
  assertIncludes("a save over 10 minutes old doesn't count", summaryText, "- Merisiel: no Reflex save rolled");
  assertIncludes("nor another save than the spell's", summaryText, "- Harsk: no Reflex save rolled");

  // The same use's other damage part: the save covers it; a later use: not
  applied.length = 0;
  ctx.api.getSelectedOrDroppedToken = () => [token("b", "Kyra", { lastSave: { ...recent(1), usedBy: "use-1" } })];
  ctx.__state.messages = [];
  ctx.applyDamageBySaves(roll);
  assert("the same use's second damage part: applied again", applied, [["b", true, false]]);
  applied.length = 0;
  ctx.__state.messages = [];
  ctx.applyDamageBySaves({ ...roll, metadata: { ...roll.metadata, basicSave: { saveType: "reflex", useId: "use-2" } } });
  assert("a later use: not applied", applied, []);
  assertIncludes("it says the save was used", ctx.__state.messages.join("\n"), "- Kyra: Reflex save already used for other damage, nothing applied");
  // Without a use id (a card from before this change): used up
  sets = [];
  ctx.api.getSelectedOrDroppedToken = () => [token("c", "Seelah", { lastSave: recent(0) })];
  ctx.applyDamageBySaves({ ...roll, metadata: { ...roll.metadata, basicSave: { saveType: "reflex" } } });
  assert("no use id: the save is cleared", sets.map(([id, , v]) => [id, v["data.lastSave"]]), [["c", null]]);

  // An ability's damage, named by its roll
  applied.length = 0;
  ctx.api.getSelectedOrDroppedToken = () => [{ token: token("g", "Harsk", { lastSave: recent(0, "fortitude") }) }];
  ctx.__state.messages = [];
  ctx.applyDamageBySaves({ total: 10, metadata: { rollName: "Avalanche Breath Damage", basicSave: { saveType: "fortitude" } } });
  assert("a selected token wrapped as { token }", applied, [["g", false, false]]);
  assertIncludes("named from the roll", ctx.__state.messages.join("\n"), "**Avalanche Breath Damage: applied by saves**\n- Harsk: Fortitude failure, full damage");

  ctx.api.getSelectedOrDroppedToken = () => [];
  notices = [];
  ctx.applyDamageBySaves(roll);
  assert("nothing selected: a notice", notices, ["Select the creatures that saved, then click again."]);
  ctx.applyDamage = savedApply;
}

process.exitCode = summary() > 0 ? 1 : 0;
