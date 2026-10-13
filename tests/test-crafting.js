// Tests for crafting: Craft projects (Player Core and Core Rulebook), formulas,
// alchemists (Player Core 2 and Core Rulebook) and the Treasure Vault options.

const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;
const useSettings = (values = {}) => {
  settings = { ...values };
};

let saved = null;
ctx.api.setValuesOnRecord = (record, values) => {
  saved = values;
};

const price = (gp = 0, sp = 0, cp = 0) => ({ value: { gp, sp, cp, pp: 0 } });
const feat = (name) => ({ name, data: { type: "skill" } });

function crafter(data = {}) {
  return {
    _id: "pc",
    recordType: "characters",
    data: {
      level: 5,
      crafting: "2",
      gp: 50,
      sp: 0,
      cp: 0,
      pp: 0,
      feats: [],
      bonusFeats: [],
      classes: [{ name: "Fighter", data: { publication: { remaster: true } } }],
      craftingItems: [],
      craftingProjects: [],
      inventory: [],
      ...data,
    },
    fields: {},
  };
}

const longsword = { _id: "ls", name: "Longsword", data: { type: "weapon", level: 0, price: price(1) } };
const potion = {
  _id: "hp",
  name: "Healing Potion (Lesser)",
  data: { type: "consumable", level: 3, price: price(12), traits: ["Consumable", "Healing", "Magical", "Potion"] },
};
const elixir = {
  _id: "el",
  name: "Elixir of Life (Minor)",
  data: { type: "consumable", level: 1, price: price(3), traits: ["Alchemical", "Consumable", "Elixir", "Healing"] },
};
const arrows = {
  _id: "ar",
  name: "Arrows",
  data: { type: "consumable", level: 0, itemCategory: "Ammo", count: 10, price: price(0, 1) },
};

section("coins");
{
  const pc = crafter({ pp: 1, gp: 2, sp: 0, cp: 5 });
  assert("coins in copper", ctx.getCoinsCp(pc), 1205);
  assert("pays with change", JSON.stringify(ctx.getCoinPayment(pc, 30)), '{"data.sp":7,"data.gp":1}');
  assert("can't afford", ctx.getCoinPayment(pc, 5000), null);
  assert("refund adds coins", JSON.stringify(ctx.getCoinRefund(pc, 1250)), '{"data.gp":14,"data.sp":5}');
}

section("rarity and DC");
{
  useSettings();
  assert("rarity from string traits", ctx.getItemRarity({ data: { traits: ["Uncommon", "Magical"] } }), "uncommon");
  assert("rarity from trait objects", ctx.getItemRarity({ data: { traitsList: [{ name: "Rare" }] } }), "rare");
  assert("rare level 3 DC", ctx.getCraftingDC({ data: { level: 3, traits: ["Rare"] } }), 23);
  assert("unique counts as a rarity", ctx.getIsTraitRarity("Unique"), true);
  useSettings({ proficiencyWithoutLevel: "yes" });
  assert("Proficiency without Level DC", ctx.getCraftingDC({ data: { level: 10 } }), 27 - 10);
  useSettings();
}

section("Income Earned, formula prices, batches");
{
  assert("level 5 expert per day", ctx.getCraftingDailyReductionCp(5, 2, false), 100);
  assert("level 5 expert critical success", ctx.getCraftingDailyReductionCp(5, 2, true), 200);
  assert("level 20 legendary critical success row", ctx.getCraftingDailyReductionCp(20, 4, true), 30000);
  assert("untrained makes no progress", ctx.getCraftingDailyReductionCp(5, 0), 0);
  assert("formula price level 0", ctx.getFormulaPriceCp({ data: { level: 0 } }), 50);
  assert("formula price level 20", ctx.getFormulaPriceCp({ data: { level: 20 } }), 350000);
  assert("consumables up to 4", ctx.getCraftBatch(potion, 9).count, 4);
  assert("batch price", ctx.getCraftBatch(potion, 2).priceCp, 2400);
  assert("permanent items one at a time", ctx.getCraftBatch(longsword, 3).count, 1);
  assert("ammunition in its bundle", ctx.getCraftBatch(arrows, 4).count, 10);
  assert("ammunition bundle price", ctx.getCraftBatch(arrows, 4).priceCp, 10);
  const efficient = crafter({ bonusFeats: [feat("Efficient Alchemy")] });
  assert("Efficient Alchemy batch of 8", ctx.getCraftBatchMax(efficient, elixir), 8);
  assert("not for magic items", ctx.getCraftBatchMax(efficient, potion), 4);
}

section("Craft requirements, remaster and legacy");
{
  useSettings();
  assert("remaster version by default", ctx.getCraftingRulesVersion(), "remaster");
  assert("remaster setup, no formula", ctx.getCraftSetupDays("remaster", false), 2);
  assert("remaster setup with formula", ctx.getCraftSetupDays("remaster", true), 1);
  assert("legacy setup", ctx.getCraftSetupDays("legacy", true), 4);
  assert("Grow setup", ctx.getCraftSetupDays("remaster", true, "grow"), 4);
  assert("remaster legendary at 17", ctx.getCraftRankNeeded({ data: { level: 16 } }, "remaster"), 3);
  assert("legacy legendary at 16", ctx.getCraftRankNeeded({ data: { level: 16 } }, "legacy"), 4);

  const check = ctx.getCraftCheck(crafter(), potion, "remaster");
  assertIncludes("magic needs Magical Crafting", check.problems, "Magic items need the Magical Crafting feat.");
  assert("remaster: no formula needed", check.problems.some((p) => p.includes("formula")), false);
  const legacyCheck = ctx.getCraftCheck(crafter({ bonusFeats: [feat("Magical Crafting")] }), potion, "legacy");
  assertIncludes("legacy: formula needed", legacyCheck.problems, "You need the item's formula.");
  const untrained = ctx.getCraftCheck(crafter({ crafting: "0" }), longsword, "remaster");
  assertIncludes("must be trained", untrained.problems, "You must be trained in Crafting.");
  const tooHigh = ctx.getCraftCheck(crafter({ level: 2 }), potion, "remaster");
  assertIncludes("level cap", tooHigh.problems, "It is level 3, above your level.");
  useSettings({ craftingRules: "legacy" });
  assert("legacy setting", ctx.getCraftingRulesVersion(), "legacy");
  useSettings();
}

section("Craft projects");
{
  useSettings();
  const formula = ctx.buildFormulaEntry(potion);
  assert("formula entry DC", formula.data.craftingDC, 18);
  assert("formula entry batch of 4", formula.data.craftingQuantity, 4);

  const pc = crafter({ craftingItems: [formula], bonusFeats: [feat("Magical Crafting")] });
  const project = ctx.buildCraftProject(pc, formula);
  assert("pays half up front", project.data.paidCp, 2400);
  assert("half remains", project.data.remainingCp, 2400);
  assert("project DC", project.data.dc, 18);
  assert("setup with the formula", project.data.setupLabel, "1 day");
  assert("buttons start hidden", project.fields.workBtn.hidden, true);
  assert("batch in the name", project.name, "Healing Potion (Lesser) (x4)");

  // Success: each extra day takes the Income Earned amount off
  const rolling = crafter({ ...pc.data, craftingProjects: [project] });
  ctx.handleCraftingRollOutcome(rolling, { craftingAction: "craft", projectId: project._id }, 1);
  assert("success: working", saved["data.craftingProjects.0.data.status"], "working");
  assert("success: level 5 expert rate", saved["data.craftingProjects.0.data.ratePerDayCp"], 100);
  assert("success: buttons shown", saved["data.craftingProjects.0.fields.finishBtn.hidden"], false);
  ctx.handleCraftingRollOutcome(rolling, { craftingAction: "craft", projectId: project._id }, 2);
  assert("critical success: level + 1 rate", saved["data.craftingProjects.0.data.ratePerDayCp"], 200);

  // Failure salvages everything; a critical failure ruins 10%
  const paid = { ...project, data: { ...project.data, coinPaidCp: 2400 } };
  const failing = crafter({ ...pc.data, gp: 0, craftingProjects: [paid] });
  ctx.handleCraftingRollOutcome(failing, { craftingAction: "craft", projectId: project._id }, 0);
  assert("failure refunds all", saved["data.gp"], 24);
  assert("failure status", saved["data.craftingProjects.0.data.status"], "failed");
  ctx.handleCraftingRollOutcome(failing, { craftingAction: "craft", projectId: project._id }, -1);
  assert("critical failure refunds 90%", `${saved["data.gp"] || 0} gp ${saved["data.sp"] || 0} sp`, "21 gp 6 sp");

  // Extra days, and rushed finishing doubles the progress
  const working = { ...project, data: { ...project.data, status: "working", ratePerDayCp: 100 } };
  assert("3 days off the cost", ctx.workCraftProjectDays(working, 3).remainingCp, 2100);
  const rushed = { ...working, data: { ...working.data, rushedFinish: true } };
  assert("rushed: double progress", ctx.workCraftProjectDays(rushed, 3).remainingCp, 1800);
  assert("never below 0", ctx.workCraftProjectDays(working, 999).remainingCp, 0);
  assert("status line", ctx.getCraftProjectStatus(working).startsWith("Remaining 24 gp"), true);

  // Finishing puts the batch in the inventory
  const done = ctx.getCraftProjectCompletion(crafter({ craftingProjects: [working] }), 0);
  assert("project removed", done["data.craftingProjects"].length, 0);
  assert("batch in inventory", done["data.inventory"][0].data.count, 4);
  assert("crafted item name", done["data.inventory"][0].name, "Healing Potion (Lesser)");

  // A reverse-engineered formula goes into the formula book instead
  const formulaProject = { ...working, data: { ...working.data, output: "formula", item: longsword } };
  const learned = ctx.getCraftProjectCompletion(crafter({ craftingProjects: [formulaProject] }), 0);
  assert("formula added to the book", learned["data.craftingItems"][0].name, "Longsword");
  assert("no inventory change", learned["data.inventory"], undefined);
}

section("Treasure Vault: Complex Crafting");
{
  assert("own level, permanent, with formula", ctx.getComplexSetupDays({ data: { level: 5 } }, 5, true), 3);
  assert("own level, consumable, no formula", ctx.getComplexSetupDays({ data: { level: 5, type: "consumable" } }, 5, false), 2);
  assert("3+ levels lower, permanent", ctx.getComplexSetupDays({ data: { level: 1 } }, 5, false), 2);
  assert("expert can rush once", ctx.getComplexRushOptions(2).length, 2);
  assert("legendary rush -3 days, DC +15", ctx.getComplexRushOptions(4)[3].dc, 15);
  assert("rushed consumable: 4 hours", ctx.getRushedSetupTime({ data: { type: "consumable" } }, 1, 2).label, "4 hours");
  assert("rushed permanent: 1 day", ctx.getRushedSetupTime({ data: {} }, 2, 3).label, "1 day");
  assert("flat check DC", ctx.getRushedFinishFlatDC(crafter(), { data: { level: 5 } }), 10 + 5 - 9);

  const project = { _id: "rp", name: "Longsword", data: { item: longsword, count: 1 } };
  const pc = crafter({ craftingProjects: [project] });
  ctx.handleCraftingRollOutcome(pc, { craftingAction: "rushedFinish", projectId: "rp" }, 0);
  assert("failed flat check: finished with a quirk", saved["data.inventory"][0].data.description.includes("quirk"), true);
  ctx.handleCraftingRollOutcome(pc, { craftingAction: "rushedFinish", projectId: "rp" }, -1);
  assert("critical failure: ruined", saved["data.craftingProjects"].length, 0);
  assert("critical failure: no item", saved["data.inventory"], undefined);
}

section("Treasure Vault: Deconstruct, events, options");
{
  const ring = { _id: "ring", name: "Ring of Energy Resistance", data: { type: "equipment", level: 6, price: price(245), traits: ["Magical", "Invested"] } };
  const pc = crafter({ level: 8, crafting: "3", inventory: [ring] });
  assertIncludes("needs Magical Crafting", ctx.getDeconstructProblems(pc, ring), "Magic items need the Magical Crafting feat.");
  const able = crafter({ level: 8, crafting: "3", inventory: [ring], bonusFeats: [feat("Magical Crafting")] });
  assert("can deconstruct", ctx.getDeconstructProblems(able, ring).length, 0);
  assertIncludes("no consumables", ctx.getDeconstructProblems(able, potion), "Consumables can't be deconstructed.");
  assert("similar item, success", ctx.getDeconstructShare(1, true), 0.75);
  assert("any item, critical success", ctx.getDeconstructShare(2, false), 0.55);
  ctx.handleCraftingRollOutcome(able, { craftingAction: "deconstruct", itemId: "ring", similar: true }, 2);
  assert("item removed", saved["data.inventory"].length, 0);
  assert("80% credit", saved["data.craftingSalvage"][0].data.valueCp, 19600);

  assert("events 1-3 use GM Core", ctx.getCraftingDowntimeEvent(3).name, "General downtime event");
  assert("event 18", ctx.getCraftingDowntimeEvent(18).name, "Suspicious offer");

  useSettings();
  assert("options off by default", Object.values(ctx.getCraftingOptions()).some((v) => v), false);
  useSettings({ natureCrafting: "nature", complexCrafting: "yes" });
  assert("Grow with Nature", ctx.getCraftingOptions().grow, "nature");
  assert("Grow rolls Nature", ctx.getCraftRollSkill("grow"), "nature");
  assert("Craft still rolls Crafting", ctx.getCraftRollSkill("craft"), "crafting");
  useSettings();
}

section("Alchemists, remaster and legacy");
{
  const alchemist = (remaster, data = {}) =>
    crafter({
      level: 3,
      int: 3,
      classes: [{ name: "Alchemist", data: { publication: { remaster } } }],
      advancedAlchemyItems: [{ data: { quantity: 3 } }, { data: { quantity: 2 } }],
      ...data,
    });

  const remaster = ctx.getAdvancedAlchemyAllowance(alchemist(true));
  assert("remaster: 4 + Int", remaster.limit, 7);
  assert("remaster: items used", remaster.used, 5);
  assert("remaster label", ctx.getAdvancedAlchemyLabel(remaster), "Remaining: 2 out of 7");
  assert("Efficient Alchemy: 6 + Int", ctx.getAdvancedAlchemyAllowance(alchemist(true, { bonusFeats: [feat("Efficient Alchemy")] })).limit, 9);
  assert(
    "module's feat name \"Efficient Alchemy (Alchemist)\" counts",
    ctx.getAdvancedAlchemyAllowance(alchemist(true, { feats: [feat("Efficient Alchemy (Alchemist)")] })).limit,
    9,
  );
  assert("Advanced Efficient Alchemy isn't plain Efficient Alchemy", ctx.hasFeatNamed(alchemist(true, { feats: [feat("Advanced Efficient Alchemy")] }), "Efficient Alchemy"), false);
  assert(
    "Advanced Efficient Alchemy at 16th: 10 + Int",
    ctx.getAdvancedAlchemyAllowance(alchemist(true, { level: 16, bonusFeats: [feat("Advanced Efficient Alchemy")] })).limit,
    13,
  );

  const legacy = ctx.getAdvancedAlchemyAllowance(alchemist(false));
  assert("legacy: level + Int reagents", legacy.limit, 6);
  assert("legacy: batches of 2", legacy.used, 3);
  assert("legacy label", ctx.getAdvancedAlchemyLabel(legacy).startsWith("Infused reagents remaining: 3 out of 6"), true);
  assert("legacy is detected", ctx.isLegacyClass({ data: { publication: { remaster: false } } }), true);
  assert("homebrew counts as remaster", ctx.isLegacyClass({ data: {} }), false);

  const withFormula = alchemist(true, { craftingItems: [elixir] });
  const moderate = { ...elixir, name: "Elixir of Life (Moderate)", data: { ...elixir.data, level: 5 } };
  assert("one formula covers every grade", ctx.hasFormulaFor(withFormula, moderate), true);
  assertIncludes("level check", ctx.getAdvancedAlchemyProblems(withFormula, moderate), "It is level 5, above your level.");
  assert("prepared from the formula book", ctx.getAdvancedAlchemyProblems(withFormula, elixir).length, 0);
  assertIncludes("not alchemical", ctx.getAdvancedAlchemyProblems(withFormula, potion), "It isn't alchemical.");

  // The sheet's recalculation keeps the limit and label right
  const values = {};
  ctx.showAlchemistFields(alchemist(false), values);
  assert("legacy limit on the sheet", values["data.numDailyCrafting"], 6);
}

process.exitCode = summary() > 0 ? 1 : 0;
