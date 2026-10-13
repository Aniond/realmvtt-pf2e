// Tests for crafting edge cases found in review: re-rolls, salvaged parts,
// formula grades, stacks, rushed finishes, Grow with Nature, the manual daily
// limit, and the sheet's second ancestry boost.

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();

let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;

// A mock api that keeps one character in memory and applies every write
let record = null;
const setPath = (target, path, value) => {
  const keys = path.split(".");
  let node = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] == null) node[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
};
const copy = () => JSON.parse(JSON.stringify(record));
const apply = (values) => {
  for (const [path, value] of Object.entries(values || {})) setPath(record, path, value);
};
let prompts = [];
let rolls = [];
let messages = [];
let notes = [];
let promptAnswers = [];
Object.assign(ctx.api, {
  getRecord: (type, id, callback) => callback(copy()),
  setValues: (values, callback) => {
    apply(values);
    if (callback) callback(copy());
  },
  setValuesOnRecord: (target, values, callback) => {
    apply(values);
    if (callback) callback(copy());
  },
  showPrompt: (title, description, placeholder, options, query, callback) => {
    prompts.push(title);
    const answer = promptAnswers.shift();
    callback(answer === undefined ? [] : [answer]);
  },
  showConfirm: (title, message, yes, no, onYes) => {
    prompts.push(title);
    onYes();
  },
  showValuePrompt: (title, name, callback) => callback("1"),
  promptRoll: (name, dice, modifiers, metadata) => rolls.push(metadata),
  sendMessage: (message) => messages.push(message),
  showNotification: (message) => notes.push(message),
});
const reset = () => {
  prompts = [];
  rolls = [];
  messages = [];
  notes = [];
  promptAnswers = [];
};

const price = (gp = 0, sp = 0, cp = 0) => ({ value: { gp, sp, cp, pp: 0 } });
const bomb = (grade = "Lesser", level = 1, gp = 3) => ({
  _id: `bomb-${grade}`,
  name: `Bottled Lightning (${grade})`,
  data: { type: "weapon", level, price: price(gp), traits: ["Common", "Alchemical", "Bomb", "Consumable"] },
});
const longsword = { _id: "ls", name: "Longsword", data: { type: "weapon", level: 0, price: price(1) } };

function crafter(data = {}) {
  record = {
    _id: "pc",
    recordType: "characters",
    data: {
      level: 5,
      crafting: "2",
      nature: "1",
      gp: 100,
      sp: 0,
      cp: 0,
      pp: 0,
      feats: [],
      bonusFeats: [{ name: "Alchemical Crafting", data: { type: "skill" } }],
      classes: [{ name: "Alchemist", data: { publication: { remaster: true } } }],
      craftingItems: [ctx.buildFormulaEntry(bomb())],
      craftingProjects: [],
      craftingSalvage: [],
      inventory: [],
      advancedAlchemyItems: [],
      int: 4,
      ...data,
    },
    fields: {},
  };
  return record;
}

const startCraft = () => {
  ctx.startCraftProject("pc", 0, "craft");
  return record.data.craftingProjects[record.data.craftingProjects.length - 1];
};
const outcome = (project, degree) =>
  ctx.handleCraftingRollOutcome(copy(), { craftingAction: "craft", projectId: project._id }, degree);

section("re-rolls replace the earlier result");
{
  settings = {};
  crafter();
  reset();
  const project = startCraft();
  assert("paid half for 4 bombs", record.data.gp, 94);
  outcome(project, 0);
  assert("failure refunds", record.data.gp, 100);
  outcome(project, 0);
  assert("a second failure doesn't refund again", record.data.gp, 100);
  outcome(project, 1);
  assert("success after a failure takes the refund back", record.data.gp, 94);
  assert("and the project is working", record.data.craftingProjects[0].data.status, "working");
  outcome(project, -1);
  assert("critical failure re-roll refunds 90%", `${record.data.gp} gp ${record.data.sp} sp`, "99 gp 4 sp");

  // If the refund was spent, the re-roll can't be applied
  record.data.gp = 0;
  record.data.sp = 0;
  const text = outcome(project, 1);
  assert("spent refund blocks the re-roll", text.includes("can't change the result"), true);
  assert("project stays failed", record.data.craftingProjects[0].data.status, "failed");
}

section("salvaged parts come back on a failure");
{
  crafter({
    craftingSalvage: [
      { _id: "parts", name: "Mirror Goggles (parts)", data: { valueCp: 10000, similarOnly: false, valueLabel: "100 gp toward any one item" } },
    ],
  });
  reset();
  promptAnswers = ["parts"];
  const project = startCraft();
  assert("parts used, no coins", record.data.gp, 100);
  assert("parts taken from the list", record.data.craftingSalvage.length, 0);
  outcome(project, 0);
  assert("failure returns the parts", record.data.craftingSalvage[0]?.data.valueCp, 10000);
  outcome(project, -1);
  assert("critical failure re-roll returns 90% of the parts", record.data.craftingSalvage[0]?.data.valueCp, 9000);
  assert("only one returned credit", record.data.craftingSalvage.length, 1);
}

section("formula grades, reverse engineering, retry");
{
  crafter();
  reset();
  ctx.promptAddFormula("pc", bomb("Moderate", 3, 10));
  assert("a higher grade of a known formula is added", record.data.craftingItems.length, 2);
  assert("for free", record.data.gp, 100);
  assert("and the player is told why", notes[0].includes("covers every grade"), true);
  ctx.promptAddFormula("pc", bomb("Moderate", 3, 10));
  assert("an exact duplicate is refused", record.data.craftingItems.length, 2);

  // Reverse engineering checks the requirements and can be retried
  crafter({ level: 2, crafting: "1", inventory: [{ ...longsword, _id: "inv-ls" }], craftingItems: [] });
  reset();
  const goggles = { _id: "gg", name: "Mirror Goggles (Lesser)", data: { level: 5, type: "equipment", price: price(135), traits: ["Invested", "Magical"] } };
  ctx.startReverseEngineering("pc", goggles);
  assert("requirements are checked", prompts.includes("Crafting Requirements"), true);
  const formulaProject = record.data.craftingProjects[0];
  assert("formula project made", formulaProject.data.output, "formula");
  outcome(formulaProject, 0);
  reset();
  ctx.retryCraftProject("pc", formulaProject._id);
  assert("retry starts the formula over", record.data.craftingProjects[0]?.data.output, "formula");
  assert("with a new Crafting roll", rolls.length, 1);
  assert("against the item's DC", rolls[0]?.dc, 20);
}

section("deconstructing one item from a stack");
{
  settings = { convertingMagicItems: "yes" };
  crafter({ inventory: [{ ...longsword, _id: "stack", data: { ...longsword.data, count: 2 } }] });
  ctx.handleCraftingRollOutcome(copy(), { craftingAction: "deconstruct", itemId: "stack", similar: false }, 1);
  assert("one comes off the stack", record.data.inventory[0].data.count, 1);
  assert("one credit", record.data.craftingSalvage.length, 1);
  assert("worth 50% of one", record.data.craftingSalvage[0].data.valueCp, 50);

  ctx.handleCraftingRollOutcome(copy(), { craftingAction: "deconstruct", itemId: "stack", similar: false }, -1);
  assert("critical failure marks it damaged", record.data.inventory[0].data.deconstructDamaged, true);
  ctx.handleCraftingRollOutcome(copy(), { craftingAction: "deconstruct", itemId: "stack", similar: false, damaged: true }, 1);
  assert("taken apart damaged: 45%", record.data.craftingSalvage[1].data.valueCp, 45);
  assert("last one removed", record.data.inventory.length, 0);
  settings = {};
}

section("rushed finish with an automatic flat check");
{
  settings = { complexCrafting: "yes" };
  crafter({ level: 6, craftingItems: [ctx.buildFormulaEntry(longsword)] });
  reset();
  const project = startCraft();
  outcome(project, 1);
  record.data.craftingProjects[0].data.rushedFinish = true;
  assert("flat DC is 1 or lower", ctx.getRushedFinishFlatDC(copy(), longsword) <= 1, true);
  rolls = [];
  ctx.finishCraftProject("pc", project._id);
  assert("no roll needed", rolls.length, 0);
  assert("item finished", record.data.inventory[0]?.name, "Longsword");
  assert("project gone", record.data.craftingProjects.length, 0);
  assert("automatic success posted", messages[0].includes("automatic success"), true);
  settings = {};
}

section("Grow with Nature uses the Nature rank");
{
  settings = { natureCrafting: "nature" };
  crafter({ crafting: "2", nature: "1" });
  reset();
  ctx.startCraftProject("pc", 0, "grow");
  const project = record.data.craftingProjects[0];
  assert("rolls Nature", project.data.skill, "nature");
  outcome(project, 1);
  assert("trained Nature rate at level 5", record.data.craftingProjects[0].data.ratePerDayCp, 90);

  crafter({ crafting: "2", nature: "0" });
  const check = ctx.getCraftCheck(copy(), bomb(), "remaster", "grow");
  assert("needs training in Nature", check.problems.includes("You must be trained in Nature."), true);
  settings = {};
}

section("formula book DC and the daily limit");
{
  crafter();
  record.data.craftingItems[0].data.craftingDC = 20;
  reset();
  const project = startCraft();
  assert("the book's DC is rolled", project.data.dc, 20);

  crafter({ numDailyCraftingOverride: 12 });
  const allowance = ctx.getAdvancedAlchemyAllowance(copy());
  assert("typed limit replaces the computed one", allowance.limit, 12);
  assert("computed limit still known", allowance.computed, 8);
  const values = {};
  ctx.showAlchemistFields(copy(), values);
  assert("recalculation keeps the typed limit", values["data.numDailyCrafting"] ?? record.data.numDailyCrafting, 12);
}

section("sheet: a Human keeps their second ancestry boost");
{
  const sheet = fs.readFileSync(`${__dirname}/../characters-main.html`, "utf8");
  new vm.Script(sheet.match(/<script>([\s\S]*?)<\/script>/)[1], { filename: "characters-main.html" }).runInContext(ctx);
  const human = {
    data: {
      ancestries: [{ name: "Human", data: { name: "Human", boosts: { 0: ["str", "dex", "con", "int", "wis", "cha"], 1: ["str", "dex", "con", "int", "wis", "cha"] } } }],
      ancestryName: "Human",
      ancestryBoost1: "int",
      ancestryBoost2: "dex",
      alternateAncestryBoosts: false,
    },
    fields: {},
  };
  let written = {};
  ctx.api.setValues = (values) => {
    written = values;
  };
  ctx.record = human;
  ctx.setAncestryBoostFields();
  assert("opening the boosts keeps a Human's second boost", written["data.ancestryBoost2"], undefined);

  const elf = {
    data: {
      ancestries: [{ name: "Elf", data: { name: "Elf", boosts: { 0: ["dex"], 1: ["int"], 2: ["str", "dex", "con", "int", "wis", "cha"] } } }],
      ancestryName: "Elf",
      ancestryBoost1: "wis",
      ancestryBoost2: "str",
      alternateAncestryBoosts: true,
    },
    fields: {},
  };
  written = {};
  ctx.record = elf;
  ctx.setAncestryBoostFields();
  assert("alternate boosts keep the second boost", written["data.ancestryBoost2"], undefined);
  written = {};
  ctx.setAncestryBoostFields(false, true);
  assert("turning alternate boosts off clears it", written["data.ancestryBoost2"], "");
}

section("Advanced Alchemy: Mark and Unmark Crafted");
{
  const row = fs.readFileSync(`${__dirname}/../advanced-alchemy-list.html`, "utf8");
  const script = row.match(/<script>([\s\S]*?)<\/script>/)[1];
  const item = { name: "Bottled Lightning (Lesser)", data: { quantity: 2, craftingDeleteBtn: "unmarkCrafted" }, fields: { markedNameBox: { hidden: false }, unmarkedNameBox: { hidden: true } } };
  let written = {};
  ctx.api.getValue = () => JSON.parse(JSON.stringify(item));
  ctx.api.setValues = (values) => {
    written = values;
  };
  ctx.dataPath = "data.advancedAlchemyItems.0.data.craftingDeleteBtn";
  new vm.Script(script, { filename: "advanced-alchemy-list.html" }).runInContext(ctx);
  ctx.onMarkCrafted();
  const path = "data.advancedAlchemyItems.0";
  assert("unmarking writes the button's value too", written[`${path}.data.craftingDeleteBtn`], "markCrafted");
  assert("and clears the strikethrough", written[`${path}.fields.markedNameBox.hidden`], true);
  item.fields = { markedNameBox: { hidden: true }, unmarkedNameBox: { hidden: false } };
  item.data.craftingDeleteBtn = "markCrafted";
  ctx.onMarkCrafted();
  assert("marking writes unmarkCrafted", written[`${path}.data.craftingDeleteBtn`], "unmarkCrafted");
  assert("and strikes the name", written[`${path}.fields.markedNameBox.hidden`], false);
  item.fields = {};
  ctx.onMarkCrafted();
  assert("a new row counts as not crafted", written[`${path}.data.craftingDeleteBtn`], "unmarkCrafted");
}

process.exitCode = summary() > 0 ? 1 : 0;
