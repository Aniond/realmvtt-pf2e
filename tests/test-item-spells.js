// Tests for casting from scrolls and wands (rollhandlers/item-spells.js):
// the item's spell and rank, the character's matching spellcasting, the
// automatic Scrolls and Wands entry (following the inventory, spending its
// item when cast from, and kept out of slots and the class's entries), Trick
// Magic Item for a character without the tradition, a scroll used up and a
// wand's use per day, refilled at rest.
// Run: node tests/test-item-spells.js (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
// spells.js shares the sheet's scope with common.js at runtime
new vm.Script(fs.readFileSync(`${__dirname}/../rollhandlers/spells.js`, "utf8"), { filename: "spells.js" }).runInContext(ctx);

// --- fixtures ---------------------------------------------------------------

const LIGHTNING_BOLT = {
  _id: "spell-lb",
  name: "Lightning Bolt",
  recordType: "spells",
  portrait: "/bolt.webp",
  data: { level: 3, traditions: ["Arcane", "Primal"], traits: ["Common", "Concentrate", "Electricity", "Manipulate"], defense: { save: { statistic: "reflex", basic: true } } },
};
const HEAL = { _id: "spell-heal", name: "Heal", recordType: "spells", data: { level: 1, traditions: ["Divine", "Primal"], traits: ["Healing", "Vitality"] } };

// The module's Wand of Crackling Lightning: the spell only linked in its text
const CRACKLING_DESCRIPTION =
  '<p><strong>Effect</strong> You cast <record-link recordlink="{&quot;value&quot;:{&quot;_id&quot;:&quot;69320cc3d316a6c798ec6090&quot;,&quot;name&quot;:&quot;Lightning Bolt&quot;,&quot;recordType&quot;:&quot;spells&quot;,&quot;identified&quot;:true},&quot;tooltip&quot;:&quot;Lightning Bolt&quot;,&quot;type&quot;:&quot;spells&quot;}">Lightning Bolt</record-link> at 3rd-rank, but the spell\'s area is twice as wide and creatures that fail are <record-link recordlink="{&quot;value&quot;:{&quot;_id&quot;:&quot;off&quot;,&quot;name&quot;:&quot;Off-Guard&quot;,&quot;recordType&quot;:&quot;effects&quot;}}">Off-Guard</record-link>.</p>';
const wand = (left = 1, extra = {}) => ({
  _id: "item-wand",
  name: "Wand of Crackling Lightning (3rd-Rank Spell)",
  recordType: "items",
  data: { type: "consumable", level: 8, traits: ["Common", "Electricity", "Magical", "Wand"], itemCategory: "Wand", description: CRACKLING_DESCRIPTION, uses: { max: 1, value: left, autoDestroy: false }, count: 1, ...extra },
});
const scroll = (count = 2) => ({
  _id: "item-scroll",
  name: "Scroll of Heal (1st-Rank)",
  recordType: "items",
  data: { type: "consumable", level: 1, traits: ["Consumable", "Magical", "Scroll"], spell: JSON.stringify({ _id: "spell-heal", name: "Heal" }), spellLevel: 1, count },
});
const potion = { _id: "item-potion", name: "Healing Potion (Minor)", data: { type: "consumable", traits: ["Consumable", "Healing", "Potion"], uses: { max: 1, value: 1 }, count: 1 } };

const entry = (name, data) => ({ _id: `entry-${name}`, name, data: { type: "prepared", tradition: "Arcane", attribute: "int", dc: 20, mod: 10, ...data }, fields: {} });
const character = (spells = [], data = {}, inventory = []) => ({
  _id: "pc",
  name: "Ezren",
  recordType: "characters",
  data: { level: 5, int: 4, wis: 1, cha: 0, arcana: 2, religion: 0, nature: 0, occultism: 0, spells, inventory, ...data },
  fields: {},
});

// --- api --------------------------------------------------------------------

// As in Realm: the stored characters (api.getRecord reads a copy), writes on
// a record change the stored one, and addValue/removeValue change the sheet's
// record (ctx.record), not the copy the script holds
let store = {};
let recordWrites = [];
let notices = [];
let added = [];
let removed = [];
let bulk = 0;
let features = 0;
const copy = (value) => JSON.parse(JSON.stringify(value));
const setPath = (target, path, value) => {
  const keys = path.split(".");
  let at = target;
  for (const key of keys.slice(0, -1)) at = at[key] = at[key] ?? {};
  at[keys[keys.length - 1]] = value;
};
const getPath = (target, path) => path.split(".").reduce((value, key) => value?.[key], target);
// With late on, the server's answers arrive later, as in Realm: a write
// changes the store when it's sent, a read copies it then, and the callbacks
// wait until settle() runs them in order
let late = false;
let waiting = [];
const respond = (cb, value) => {
  if (!cb) return;
  if (late) waiting.push(() => cb(value));
  else cb(value);
};
function settle() {
  while (waiting.length > 0) waiting.shift()();
  late = false;
}
const spellsByName = { "Lightning Bolt": LIGHTNING_BOLT, Heal: HEAL };
ctx.getNearestParentDataPath = (path) => `${path}`.replace(/\.data\.[^.]+\.\d+$/, "");
ctx.api.richTextToMarkdown = (text) => `${text || ""}`;
ctx.assetUrl = "";
ctx.api.getValueOnRecord = (target, path) => getPath(target, path);
ctx.api.getValue = (path) => getPath(store[ctx.record?._id] || ctx.record, path);
ctx.api.showNotification = (message) => notices.push(message);
ctx.api.getRecord = (type, id, cb) => {
  if (type === "spells") return respond(cb, Object.values(spellsByName).find((s) => s._id === id) || null);
  respond(cb, store[id] ? copy(store[id]) : null);
};
// The description links the module's spell id: only the name finds it
ctx.api.getRecordByTypeAndName = (type, name, cb) => respond(cb, spellsByName[name] || null);
ctx.api.setValuesOnRecord = (record, values, cb) => {
  recordWrites.push(values);
  const stored = store[record._id] || copy(record);
  Object.entries(values).forEach(([path, value]) => setPath(stored, path, copy(value)));
  store[record._id] = stored;
  respond(cb, copy(stored));
};
ctx.api.setValues = (values, cb) => ctx.api.setValuesOnRecord(ctx.record, values, cb);
// As in Realm: an added value gets a new _id, and a remove finds the value
// at the index in the record it's given (removeValue: the sheet's, bound when
// the script started) and pulls it by its _id, so removing one already gone
// removes nothing
let nextId = 0;
const addTo = (target, path, values, cb) => {
  values.forEach((value) => {
    added.push([path, copy(value)]);
    getPath(store[target._id], path).push({ ...copy(value), _id: `added-${(nextId += 1)}` });
  });
  // The callback hands back the copy from before
  respond(cb, target);
};
const removeFrom = (target, path, index, cb) => {
  removed.push([path, index]);
  const id = getPath(target, path)?.[index]?._id;
  const list = getPath(store[target._id], path);
  const at = list.findIndex((value) => value?._id === id);
  if (id && at >= 0) list.splice(at, 1);
  respond(cb, copy(store[target._id]));
};
ctx.api.addValue = (path, value, cb) => addTo(ctx.record, path, [value], cb);
ctx.api.addValuesToRecord = (target, path, values, cb) => addTo(target, path, values, cb);
ctx.api.removeValue = (path, index, cb) => removeFrom(ctx.record, path, index, cb);
ctx.api.removeValueFromRecord = (target, path, index, cb) => removeFrom(target, path, index, cb);
ctx.updateTotalBulk = (record, write = true) => {
  bulk += 1;
  return 0;
};
ctx.onAddEditFeature = () => {
  features += 1;
};

// Puts a character on the sheet and in the store
function open(record) {
  store = { [record._id]: copy(record) };
  ctx.record = copy(record);
  recordWrites = [];
  notices = [];
  added = [];
  removed = [];
  bulk = 0;
  features = 0;
  ctx.__state.messages = [];
}
const stored = () => store[ctx.record._id];
const itemEntry = () => stored().data.spells.find((e) => e.data?.itemSpells);

// Casts the row at path from the stored character, as the sheet does
function castRow(path) {
  ctx.castSpell(copy(stored()), getPath(stored(), path), path);
}

section("Which items cast a spell, and which spell at which rank");
{
  assert("a wand by its trait", ctx.getItemSpellKind(wand()), "wand");
  assert("or Foundry's wand category", ctx.getItemSpellKind({ data: { itemCategory: "wand", traits: [] } }), "wand");
  assert("a scroll by its trait", ctx.getItemSpellKind(scroll()), "scroll");
  assert("a potion (one use, like a wand): not one", ctx.getItemSpellKind(potion), null);

  assert("the Spell field", ctx.getItemSpellRef(scroll()), { _id: "spell-heal", name: "Heal" });
  assert("the spell the description links (not the effect)", ctx.getItemSpellRef(wand()), { _id: "69320cc3d316a6c798ec6090", name: "Lightning Bolt" });
  assert("no spell: none", ctx.getItemSpellRef({ data: { description: "<p>A stick.</p>" } }), null);

  assert("the Level field", ctx.getItemSpellRank(scroll()), 1);
  assert("\"(3rd-Rank Spell)\" in the name", ctx.getItemSpellRank(wand()), 3);
  assert("legacy \"(5th-Level Spell)\"", ctx.getItemSpellRank({ name: "Wand of Fireball (5th-Level Spell)", data: {} }), 5);
  assert("\"at 3rd-rank\" in the text", ctx.getItemSpellRank({ name: "Wand of Crackling Lightning", data: { description: CRACKLING_DESCRIPTION } }), 3);
  assert("none: the spell's own", ctx.getItemSpellRank({ name: "Scroll", data: {} }), null);

  assert("the spell's traditions", ctx.getSpellTraditions(LIGHTNING_BOLT), ["arcane", "primal"]);
}

section("The character's matching spellcasting");
{
  const pc = character([
    entry("Arcane Prepared Spells", { dc: 21 }),
    entry("Bloodline", { type: "spontaneous", dc: 23 }),
    entry("Focus", { type: "focus", dc: 30 }),
    entry("Innate", { type: "innate", dc: 31 }),
    entry("Divine", { tradition: "Divine", dc: 40 }),
    entry("Scrolls and Wands", { type: "item", itemSpells: true, dc: 50 }),
  ]);
  assert("the best prepared or spontaneous entry of the tradition", ctx.getBestCastingEntry(pc, ["arcane", "primal"]).name, "Bloodline");
  assert("divine: its own entry", ctx.getBestCastingEntry(pc, ["divine"]).name, "Divine");
  assert("no occult entry: none (focus, innate and Scrolls and Wands don't count)", ctx.getBestCastingEntry(pc, ["occult"]), null);
  // An entry that already lists the spell counts, whatever its tradition
  // (Foundry's canCast: isInSpellList), like a sorcerer's bloodline spells
  const sorcerer = character([entry("Occult Spontaneous Spells", { tradition: "Occult", type: "spontaneous", dc: 20, spells3: [{ _id: "x", name: "Lightning Bolt", data: {} }] })]);
  assert("an entry listing the spell: it casts with that entry", ctx.getBestCastingEntry(sorcerer, ["arcane", "primal"], LIGHTNING_BOLT).name, "Occult Spontaneous Spells");
  assert("without the spell given: tradition only", ctx.getBestCastingEntry(sorcerer, ["arcane", "primal"]), null);
}

section("The Scrolls and Wands entry follows the inventory");
{
  // Adding a wand: its row is there straight away (David: it only showed
  // after Use)
  open(character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 })], {}, [wand()]));
  let after = null;
  ctx.syncItemSpells(ctx.record, (record) => (after = record));
  const made = itemEntry();
  assert("the entry is added once, not all of data.spells written", [added.length, added[0][0], recordWrites.length], [1, "data.spells", 0]);
  assert("after the character's entries", stored().data.spells.map((e) => e.name), ["Arcane Prepared Spells", "Scrolls and Wands"]);
  assert("with the caster's numbers", [made.data.type, made.data.dc, made.data.mod, made.data.tradition], ["item", 21, 11, "Arcane"]);
  const row = made.data.spells3[0];
  assert("the spell at the wand's rank (found by name: the link has the module's id)", [row.name, row.data.type, made.data.shownSpells, made.fields.spells3Box], ["Lightning Bolt", "spell", ["spells3"], { hidden: false }]);
  assert("showing the wand's use for the day", [row.data.uses, row.data.maxUses, row.fields.innateBox], [1, 1, { hidden: false }]);
  assert("and naming its wand", row.data.itemSpell, { itemId: "item-wand", itemIndex: 0, itemName: "Wand of Crackling Lightning (3rd-Rank Spell)", kind: "wand", spellId: "spell-lb" });
  assert("no delete of its own (it goes with the wand)", row.fields.deleteBtn, { hidden: true });
  assert("the callback gets the record read again, with the entry", after.data.spells.length, 2);

  // Nothing changed: no write, no look-up
  added = [];
  let lookups = 0;
  const savedByName = ctx.api.getRecordByTypeAndName;
  ctx.api.getRecordByTypeAndName = (type, name, cb) => {
    lookups += 1;
    savedByName(type, name, cb);
  };
  ctx.syncItemSpells(ctx.record);
  assert("again: nothing written, the spell not looked up again", [added.length, recordWrites.length, removed.length, lookups], [0, 0, 0, 0]);

  // A scroll joins: only the entry is written
  stored().data.inventory.push(scroll(2));
  ctx.syncItemSpells(ctx.record);
  assert("a second item: only data.spells.1, in one write", recordWrites.map((values) => Object.keys(values)), [["data.spells.1"]]);
  assert("its own row at its rank, showing how many", [itemEntry().data.spells1[0].name, itemEntry().data.spells1[0].data.uses, itemEntry().data.shownSpells], ["Heal", 2, ["spells1", "spells3"]]);
  ctx.api.getRecordByTypeAndName = savedByName;

  // Deleting the wand takes its row (David: the spell stayed)
  recordWrites = [];
  stored().data.inventory.splice(0, 1);
  ctx.syncItemSpells(ctx.record);
  assert("the wand deleted: its row goes, the scroll's moves to its new place", [itemEntry().data.spells3, itemEntry().data.spells1[0].data.itemSpell.itemIndex], [[], 0]);
  assert("its rank hidden", [itemEntry().data.shownSpells, itemEntry().fields.spells3Box], [["spells1"], { hidden: true }]);

  // The last one deleted: no entry left (Quill had a Heal row and no scroll)
  stored().data.inventory = [];
  ctx.syncItemSpells(ctx.record);
  assert("none left: the entry is removed", [removed, stored().data.spells.map((e) => e.name)], [[["data.spells", 1]], ["Arcane Prepared Spells"]]);

  open(character([entry("Arcane Prepared Spells")], {}, [potion]));
  ctx.syncItemSpells(ctx.record);
  assert("no scrolls or wands: nothing", [added, recordWrites, removed], [[], [], []]);
  open({ ...character([], {}, [wand()]), recordType: "npcs" });
  ctx.syncItemSpells(ctx.record);
  assert("an NPC: nothing", [added, recordWrites], [[], []]);
}

section("Adding, equipping, counting and deleting bring it up to date");
{
  for (const file of ["characters-inventory.html", "inventory-list.html"]) {
    const html = fs.readFileSync(`${__dirname}/../${file}`, "utf8");
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      new vm.Script(match[1], { filename: file }).runInContext(ctx);
    }
  }

  // Equipping a wand whose spell was just set (David's report)
  open(character([entry("Arcane Prepared Spells")], {}, [wand()]));
  ctx.onItemEquippedFor("data.inventory.0", "equipped");
  assert("equipping the wand: its row is there", [itemEntry()?.data.spells3[0].name, features], ["Lightning Bolt", 1]);
  open(character([], {}, [potion]));
  ctx.onItemEquippedFor("data.inventory.0", "equipped");
  assert("equipping anything else: no read, no entry", [stored().data.spells.length, added.length, features], [0, 0, 1]);

  // Dropped on the sheet
  open(character([entry("Arcane Prepared Spells")]));
  ctx.onDropItem({ value: wand() });
  assert("a wand dropped on the sheet: its row, then bulk", [itemEntry()?.data.spells3[0].name, bulk], ["Lightning Bolt", 1]);

  // Deleted from the list
  open(character([entry("Arcane Prepared Spells")], {}, [wand()]));
  ctx.syncItemSpells(ctx.record);
  stored().data.inventory = [];
  ctx.record = copy(stored());
  ctx.onItemDeleted();
  assert("the wand deleted from the list: the entry goes too", [stored().data.spells.map((e) => e.name), features], [["Arcane Prepared Spells"], 1]);

  // A scroll's count typed in
  open(character([entry("Divine Prepared Spells", { tradition: "Divine" })], {}, [scroll(2)]));
  ctx.syncItemSpells(ctx.record);
  stored().data.inventory[0].data.count = 5;
  ctx.dataPath = "data.inventory.0.data.count";
  ctx.getNearestParentDataPath = (path) => (path === ctx.dataPath ? "data.inventory.0" : `${path}`.replace(/\.data\.[^.]+\.\d+$/, ""));
  ctx.onCountChange(5);
  assert("its row shows the new count", itemEntry().data.spells1[0].data.uses, 5);
  ctx.getNearestParentDataPath = (path) => `${path}`.replace(/\.data\.[^.]+\.\d+$/, "");
}

section("Casting from the entry spends the wand (David: it wasn't marked)");
{
  open(character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 })], {}, [wand()]));
  ctx.syncItemSpells(ctx.record);
  recordWrites = [];
  castRow("data.spells.1.data.spells3.0");
  assert("one write", recordWrites.length, 1);
  assert("the wand's use spent, and the row shows it", [stored().data.inventory[0].data.uses.value, itemEntry().data.spells3[0].data.uses], [0, 0]);
  assert("the caster's numbers for this spell, on the entry", [itemEntry().data.dc, itemEntry().data.mod], [21, 11]);
  assertIncludes("the card says where it's from, with what", ctx.__state.messages[0], "*From Wand of Crackling Lightning (3rd-Rank Spell): Arcane spell DC 21, attack +11*");
  assertIncludes("the spell's card", ctx.__state.messages[0], "Lightning Bolt");

  // Spent: it still casts, with the overcharge line, never "out of uses"
  ctx.__state.messages = [];
  castRow("data.spells.1.data.spells3.0");
  assert("spent today: not refused", [notices, ctx.__state.messages.length], [[], 1]);
  assertIncludes("a short overcharge line", ctx.__state.messages[0], "**Overcharge:** already used today (DC 10 flat check, GM Core pg. 282).");
  assert("nothing more spent", stored().data.inventory[0].data.uses.value, 0);

  // A level up since: the numbers are worked out at the cast
  stored().data.spells[0].data.dc = 24;
  stored().data.spells[0].data.mod = 14;
  ctx.__state.messages = [];
  castRow("data.spells.1.data.spells3.0");
  assertIncludes("the DC as it is now", ctx.__state.messages[0], "Arcane spell DC 24, attack +14");

  // A row from before rows named their item finds its wand by the spell
  open(character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 }), { _id: "old", name: "Scrolls and Wands", data: { type: "item", itemSpells: true, dc: 21, mod: 11, tradition: "Arcane", spells3: [{ _id: "spell-lb", name: "Lightning Bolt", data: { ...LIGHTNING_BOLT.data, uses: 0, maxUses: 0 } }] }, fields: {} }], {}, [wand()]));
  castRow("data.spells.1.data.spells3.0");
  assert("an older row (0/0): casts, and spends the wand with the spell", [notices, stored().data.inventory[0].data.uses.value], [[], 0]);

  // Its wand gone: it still casts, and says so
  open(character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 })], {}, [wand()]));
  ctx.syncItemSpells(ctx.record);
  stored().data.inventory = [];
  castRow("data.spells.1.data.spells3.0");
  assertIncludes("its wand gone: cast, with a line", ctx.__state.messages[0], "*Wand of Crackling Lightning (3rd-Rank Spell) is no longer in the inventory.*");

  // An overlay is part of a cast already made
  open(character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 })], {}, [wand()]));
  ctx.syncItemSpells(ctx.record);
  const overlayPath = "data.spells.1.data.spells3.0.data.overlays.0";
  setPath(stored(), overlayPath, { name: "Wide", data: { time: "2" } });
  recordWrites = [];
  ctx.castSpell(copy(stored()), getPath(stored(), overlayPath), overlayPath, true);
  assert("an overlay: nothing spent, not refused", [stored().data.inventory[0].data.uses.value, notices], [1, []]);
}

section("Scrolls from the entry");
{
  const cleric = () => character([entry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", dc: 19, mod: 9 })], {}, [scroll(2)]);
  open(cleric());
  ctx.syncItemSpells(ctx.record);
  castRow("data.spells.1.data.spells1.0");
  assert("one fewer, the row shows it, bulk again", [stored().data.inventory[0].data.count, itemEntry().data.spells1[0].data.uses, bulk], [1, 1, 1]);
  assertIncludes("the cleric's DC", ctx.__state.messages[0], "*From Scroll of Heal (1st-Rank): Divine spell DC 19, attack +9*");

  // The last scroll, which auto-destroys like other consumables
  open(character(cleric().data.spells, {}, [{ ...scroll(1), data: { ...scroll(1).data, uses: { autoDestroy: true } } }]));
  ctx.syncItemSpells(ctx.record);
  castRow("data.spells.1.data.spells1.0");
  assert("at 0 it is removed, and its row (no entry left), then bulk", [removed, stored().data.inventory.length, stored().data.spells.length, bulk], [[["data.inventory", 0], ["data.spells", 1]], 0, 1, 1]);

  open(character(cleric().data.spells, {}, [scroll(1)]));
  ctx.syncItemSpells(ctx.record);
  castRow("data.spells.1.data.spells1.0");
  assert("without auto-destroy it stays at 0, with its row", [removed, stored().data.inventory[0].data.count, itemEntry().data.spells1[0].data.uses], [[], 0, 0]);
}

section("Use on a wand or scroll casts its row");
{
  open(character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 })], {}, [wand()]));
  assert("handled", ctx.useItemSpell(ctx.record, wand(), "data.inventory.0"), true);
  assert("the entry made, the wand spent, one card", [itemEntry().data.spells3[0].name, stored().data.inventory[0].data.uses.value, ctx.__state.messages.length], ["Lightning Bolt", 0, 1]);
  assertIncludes("the card", ctx.__state.messages[0], "*From Wand of Crackling Lightning (3rd-Rank Spell): Arcane spell DC 21, attack +11*");

  // useInventoryItem hands it over before posting the description
  open(character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 })], {}, [wand()]));
  ctx.useInventoryItem("data.inventory.0");
  assert("Use on the wand casts it, one card", [stored().data.inventory[0].data.uses.value, ctx.__state.messages.length], [0, 1]);

  open(character([entry("Arcane Prepared Spells")], {}, [potion]));
  assert("a potion: Use as before", ctx.useItemSpell(ctx.record, potion, "data.inventory.0"), false);
  assert("an NPC: Use as before", ctx.useItemSpell({ ...ctx.record, recordType: "npcs" }, wand(), "data.inventory.0"), false);
  assert("nothing written", [added, recordWrites], [[], []]);
}

section("Answers that arrive late: overlapping syncs and casts");
{
  // Realm runs every click as a script of its own, so nothing is shared
  // between two syncs: each reads, writes against its read, and removes by
  // _id. Here their answers arrive late, so they overlap.
  const names = () => stored().data.spells.map((e) => e.name);
  const divine = () => entry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", dc: 19, mod: 9 });

  // The last scrolls deleted quickly: two syncs remove the entry
  open(character([divine()], {}, [scroll(2)]));
  ctx.syncItemSpells(ctx.record);
  stored().data.spells.push(entry("Focus Spells", { type: "focus" }));
  stored().data.inventory = [];
  ctx.record = copy(stored());
  late = true;
  ctx.syncItemSpells(ctx.record);
  ctx.syncItemSpells(ctx.record);
  settle();
  assert("two syncs at once remove only Scrolls and Wands", names(), ["Divine Prepared Spells", "Focus Spells"]);

  // Two wands equipped quickly: both syncs add the entry, then each reads
  // again and removes any but the first
  open(character([divine()], {}, [wand()]));
  let calls = 0;
  late = true;
  ctx.syncItemSpells(ctx.record, () => (calls += 1));
  ctx.syncItemSpells(ctx.record, () => (calls += 1));
  ctx.syncItemSpells(ctx.record, () => (calls += 1));
  settle();
  assert("syncs at once leave one entry", names(), ["Divine Prepared Spells", "Scrolls and Wands"]);
  assert("the first one added", itemEntry()._id, "added-" + (nextId - 2));
  assert("and each one's callback runs", calls, 3);

  // A leftover second entry with no scrolls or wands left: both go
  open(character([divine(), entry("Scrolls and Wands", { type: "item", itemSpells: true }), entry("Scrolls and Wands 2", { type: "item", itemSpells: true })]));
  ctx.syncItemSpells(ctx.record);
  assert("none left: every Scrolls and Wands entry goes", names(), ["Divine Prepared Spells"]);

  // Use double-clicked on the last scroll, a potion after it
  const lastScroll = { ...scroll(1), data: { ...scroll(1).data, uses: { autoDestroy: true } } };
  open(character([divine()], {}, [lastScroll, potion]));
  ctx.syncItemSpells(ctx.record);
  const before = copy(stored());
  const path = "data.spells.1.data.spells1.0";
  late = true;
  ctx.castSpell(copy(before), getPath(before, path), path);
  ctx.castSpell(copy(before), getPath(before, path), path);
  settle();
  assert("a double click removes the scroll, not the potion", stored().data.inventory.map((i) => i.name), ["Healing Potion (Minor)"]);
  assert("and the entry with it", names(), ["Divine Prepared Spells"]);

  // The inventory moves before the used-up scroll is removed (another
  // client drops the potion in front of it): the scroll goes, by its id
  open(character([divine()], {}, [potion, lastScroll]));
  ctx.syncItemSpells(ctx.record);
  const moved = copy(stored());
  late = true;
  ctx.castSpell(copy(moved), getPath(moved, path), path);
  stored().data.inventory.shift();
  settle();
  assert("the moved scroll is removed, nothing else", stored().data.inventory.map((i) => i.name), []);

  // More scrolls of it added before the removal: it stays
  open(character([divine()], {}, [lastScroll]));
  ctx.syncItemSpells(ctx.record);
  const restocked = copy(stored());
  late = true;
  ctx.castSpell(copy(restocked), getPath(restocked, "data.spells.1.data.spells1.0"), "data.spells.1.data.spells1.0");
  stored().data.inventory[0].data.count = 3;
  settle();
  assert("restocked meanwhile: the scroll stays", stored().data.inventory.map((i) => i.data.count), [3]);

  // Use finds its row by the item's id, if the inventory moved since
  open(character([divine()], {}, [potion, scroll(2)]));
  ctx.syncItemSpells(ctx.record);
  assert("the row by the item's id", ctx.getItemSpellRowPath(stored(), 0, "item-scroll"), "data.spells.1.data.spells1.0");
  assert("not the row at the old index", ctx.getItemSpellRowPath(stored(), 1, "item-wand"), null);
}

section("Trick Magic Item without the tradition: it just casts");
{
  // Player Core pg. 264: level as proficiency, the highest of Int/Wis/Cha
  const fighter = character([], { int: 1, wis: 2, cha: 0, arcana: 1, nature: 3 }, [wand()]);
  assert("trained: level 5 + Wis 2", ctx.getTrickMagicItemCasting(fighter, "arcana", "arcane"), { dc: 17, mod: 7, attribute: "wis", tradition: "Arcane" });
  assert("master in the skill: the trained bonus (level + 2)", ctx.getTrickMagicItemCasting(fighter, "nature", "primal").mod, 9);
  assert("legendary: the expert bonus (level + 4)", ctx.getTrickMagicItemCasting({ ...fighter, data: { ...fighter.data, nature: 4 } }, "nature", "primal").mod, 11);
  const wizard = character([entry("Arcane Prepared Spells", { dc: 22, mod: 12 })]);
  assert("a caster of another tradition: Trick Magic Item's numbers too, not their own DC (Sean's review; Foundry's TrickMagicItemEntry)", ctx.getTrickMagicItemCasting(wizard, "religion", "divine"), { dc: 19, mod: 9, attribute: "int", tradition: "Divine" });

  // Use casts straight away, with the tradition skill the fighter is best at
  // (Nature for primal)
  open(fighter);
  ctx.useItemSpell(ctx.record, wand(), "data.inventory.0");
  assertIncludes("cast with Trick Magic Item's numbers, and the card says so", ctx.__state.messages[0], "Primal spell DC 19, attack +9*\n*Trick Magic Item* (Player Core pg. 264)");
  assert("one card, the wand spent", [ctx.__state.messages.length, stored().data.inventory[0].data.uses.value], [1, 0]);
  assert("from a new Scrolls and Wands entry", [stored().data.spells[0].name, stored().data.spells[0].data.dc], ["Scrolls and Wands", 19]);
}

section("The entry stays out of slots and the class's entries; rest refills its wands");
{
  open(character([entry("Arcane Prepared Spells", { dc: 21 })], { curhp: 10, hitpoints: 40, con: 1 }, [wand(0), scroll(1), { ...potion, data: { ...potion.data, uses: { max: 1, value: 0 } } }]));
  ctx.syncItemSpells(ctx.record);
  const made = copy(stored().data.spells);
  made[0].data.spells1 = [{ _id: "fb", name: "Force Barrage", data: { used: true } }];
  stored().data.spells = made;
  const pc = copy(stored());
  assert("a spent wand's row shows 0", made[1].data.spells3[0].data.uses, 0);

  // Daily preparations (characters-main.html's rest; David: still "out of
  // uses" after resting)
  const html = fs.readFileSync(`${__dirname}/../characters-main.html`, "utf8");
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: "characters-main.html" }).runInContext(ctx);
  }
  open(pc);
  const writes = [];
  ctx.api.setValues = (values, cb) => {
    writes.push(values);
    if (cb) cb(copy(stored()));
  };
  ctx.restWith({}); // rest() asks how they rested first (healing-tools.js)
  const rested = writes.find((values) => "data.curhp" in values) || {};
  assert("rest refills the wand's use", rested["data.inventory.0.data.uses.value"], 1);
  assert("and its row shows it", rested["data.spells.1.data.spells3.0.data.uses"], 1);
  assert("not a potion's", rested["data.inventory.2.data.uses.value"], undefined);
  assert("nothing else of the entry (the scroll's row stays)", Object.keys(rested).filter((key) => key.startsWith("data.spells.1.")), ["data.spells.1.data.spells3.0.data.uses"]);
  assert("while the character's own prepared spells are reset", rested["data.spells.0.data.spells1.0.data.used"], false);
  ctx.api.setValues = (values, cb) => ctx.api.setValuesOnRecord(ctx.record, values, cb);

  // Recalculating entries and the class's entries
  const values = {};
  ctx.updateSpellcastingEntries(pc, values, copy(made));
  assert("recalculating entries doesn't touch its DC", Object.keys(values).filter((key) => key.startsWith("data.spells.1.")), []);
  const synced = ctx.syncSpellcastingEntries({ ...pc, data: { ...pc.data, autoSpellcasting: true } }, {});
  assert("the class's entries keep it as it is", synced.find((e) => e.name === "Scrolls and Wands")?.data.dc, 21);
  assert("no focus points from it", ctx.getFocusPoolMax(pc), 0);
  assert("its spells aren't a focus entry's", ctx.getFocusSpellCount(made), 0);
  ctx.record = { data: {}, fields: {}, type: "characters", _id: "test" };
}

process.exitCode = summary() > 0 ? 1 : 0;
