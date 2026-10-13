// Tests for the Character Creation Wizard equipment step (Player Core Step 8).
// Item shapes mirror the Player Core module data.

const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();

const price = (gp = 0, sp = 0, cp = 0) => ({ value: { gp, sp, cp, pp: 0 } });
const longsword = {
  _id: "longsword",
  name: "Longsword",
  data: { type: "weapon", level: 0, price: price(1), bulk: { value: 1 } },
};
const arrows = {
  _id: "arrows",
  name: "Arrows",
  data: { type: "consumable", level: 0, price: price(0, 1), count: 10, bulk: { value: 0.01 } },
};
const adventurersPack = {
  _id: "pack",
  name: "Adventurer's Pack",
  data: {
    type: "kit",
    price: price(0, 15),
    items: [
      { name: "Backpack", data: { type: "backpack", count: 1 } },
      { name: "Torch", data: { type: "equipment", count: 5 } },
      { name: "Rations", data: { type: "consumable", count: 2 } },
    ],
  },
};

section("prices and coins");
{
  assert("1 gp", ctx.getItemPriceCp(longsword), 100);
  assert("15 sp", ctx.getItemPriceCp(adventurersPack), 150);
  assert("no price", ctx.getItemPriceCp({ data: {} }), 0);
  assert("split", JSON.stringify(ctx.splitCp(1234)), '{"gp":12,"sp":3,"cp":4}');
  assert("format", ctx.formatCp(920), "9 gp, 2 sp");
  assert("format zero", ctx.formatCp(0), "0 cp");
  assert(
    "starting wealth",
    new vm.Script("WIZARD_STARTING_WEALTH_CP").runInContext(ctx),
    1500,
  );
}

section("purchases");
{
  let items = [];
  items = ctx.addWizardPurchase(items, ctx.buildWizardPurchase(longsword));
  items = ctx.addWizardPurchase(items, ctx.buildWizardPurchase(arrows));
  items = ctx.addWizardPurchase(items, ctx.buildWizardPurchase(arrows));
  assert("arrows stack", items.length, 2);
  assert("arrows count", items[1].data.count, 20);
  assert("arrow bundle", items[1].data.bundleSize, 10);
  assert("price label per bundle", items[1].data.priceLabel, "1 sp per 10");
  assert("spent: 1 gp + 2 sp", ctx.getWizardSpentCp(items), 120);

  // Class kit items are paid for by the kit price, not per item
  items = ctx.addWizardPurchase(items, ctx.buildWizardPurchase(longsword, 1, true));
  assert("kit item kept separate", items.length, 3);
  assert("kit price used", ctx.getWizardSpentCp(items, 582), 702);
  assert("kit label", items[2].data.priceLabel, "Class Kit");

  // Kits never stack, so each one unpacks separately
  items = ctx.addWizardPurchase(items, ctx.buildWizardPurchase(adventurersPack));
  items = ctx.addWizardPurchase(items, ctx.buildWizardPurchase(adventurersPack));
  assert("kits listed separately", items.length, 5);
}

section("buildInventoryFromPurchases");
{
  const purchases = [
    ctx.buildWizardPurchase(longsword),
    ctx.buildWizardPurchase(adventurersPack),
    ctx.buildWizardPurchase(adventurersPack),
  ];
  const existing = [
    { _id: "inv-1", name: "Longsword", data: { fromId: "longsword", count: 1 } },
  ];
  const inventory = ctx.buildInventoryFromPurchases(existing, purchases);
  const byName = (name) => inventory.filter((item) => item.name === name);

  assert("longsword stacks with existing", byName("Longsword").length, 1);
  assert("longsword count", byName("Longsword")[0].data.count, 2);
  assert("kit itself not added", byName("Adventurer's Pack").length, 0);
  assert("backpacks never stack", byName("Backpack").length, 2);
  assert("torches stack by name", byName("Torch")[0].data.count, 10);
  assert("rations stack by name", byName("Rations")[0].data.count, 4);
  assert("items carried", byName("Torch")[0].data.carried, "carried");
  assert("wizard fields removed", byName("Longsword")[0].data.priceLabel, undefined);
  assert(
    "new items get fresh ids",
    byName("Torch")[0]._id !== undefined && byName("Torch")[0]._id !== "pack",
    true,
  );
}

section("class kits");
{
  const kits = new vm.Script("PF2E_CLASS_KITS").runInContext(ctx);
  const kitFor = (name) => ctx.getClassKit({ data: { classes: [{ name }] } });

  assert("16 kits", Object.keys(kits).length, 16);
  assert("fighter kit by class name", kitFor("Fighter").name, "Fighter Kit");
  assert("falls back to className", ctx.getClassKit({ data: { className: "Wizard" } }).name, "Wizard Kit");
  assert("no kit for gunslinger", kitFor("Gunslinger"), null);
  assert("fighter kit price", kitFor("Fighter").priceCp, 580);

  let valid = true;
  for (const kit of Object.values(kits)) {
    const prices = [kit.priceCp, ...kit.options.map((o) => o.priceCp)];
    const items = [...kit.items, ...kit.options.flatMap((o) => o.items)];
    if (prices.some((p) => typeof p !== "number" || p < 0)) valid = false;
    if (kit.options.some((o) => o.items.length === 0)) valid = false;
    if (items.some((i) => !i.name || !(i.count >= 1))) valid = false;
  }
  assert("every kit has prices, items and counts", valid, true);

  assert(
    "description",
    ctx.getClassKitDescription(kitFor("Wizard")),
    "Wizard Kit (2 gp, 6 sp): Explorer's Clothing, Staff, Adventurer's Pack, Writing Set. Options: Crossbow with 20 Bolts (+3 gp, 2 sp).",
  );
  assert(
    "deity weapon note",
    ctx.getClassKitDescription(kitFor("Cleric")).endsWith(
      "Also buy your deity's favored weapon in the shop below.",
    ),
    true,
  );
  assert("ammo count in kit", kitFor("Fighter").options[1].items[1].count, 20);
}

process.exitCode = summary();
