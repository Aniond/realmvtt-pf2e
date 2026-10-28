// Tests for casting from scrolls and wands (rollhandlers/item-spells.js):
// the item's spell and rank, the character's matching spellcasting, the
// automatic Scrolls and Wands entry (refreshed on every cast and kept out of
// slots, daily preparations and the class's entries), Trick Magic Item for a
// character without the tradition, a scroll used up and a wand's use per day.
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

let sets = [];
let recordWrites = [];
let casts = [];
let notices = [];
ctx.api.setValues = (values, cb) => {
  sets.push(values);
  if (cb) cb();
};
ctx.api.setValuesOnRecord = (record, values, cb) => {
  recordWrites.push(values);
  const updated = JSON.parse(JSON.stringify(record));
  Object.entries(values).forEach(([path, value]) => {
    const keys = path.split(".");
    let target = updated;
    for (const key of keys.slice(0, -1)) target = target[key] = target[key] ?? {};
    target[keys[keys.length - 1]] = value;
  });
  if (cb) cb(updated);
};
ctx.api.getValueOnRecord = (target, path) => path.split(".").reduce((value, key) => value?.[key], target);
ctx.api.showNotification = (message) => notices.push(message);
// The description links the module's spell id: only the name finds it
const spellsByName = { "Lightning Bolt": LIGHTNING_BOLT, Heal: HEAL };
let records = {};
ctx.api.getRecord = (type, id, cb) => cb(type === "spells" ? Object.values(spellsByName).find((s) => s._id === id) || null : records[id] || null);
ctx.api.getRecordByTypeAndName = (type, name, cb) => cb(spellsByName[name] || null);
ctx.castSpell = (record, spell, path) => casts.push({ record, spell, path });

function reset() {
  sets = [];
  recordWrites = [];
  casts = [];
  notices = [];
  ctx.__state.messages = [];
}

// --- tests ------------------------------------------------------------------

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
}

section("The Scrolls and Wands entry, refreshed on every cast");
{
  const pc = character([entry("Arcane Prepared Spells")]);
  const first = ctx.getItemSpellEntries(pc, LIGHTNING_BOLT, 3, { dc: 21, mod: 11, attribute: "int", tradition: "Arcane" });
  const made = first.entries[1];
  assert("made after the character's entries", [made.name, made.data.type, made.data.itemSpells], ["Scrolls and Wands", "item", true]);
  assert("with the caster's DC, attack, attribute and tradition", [made.data.dc, made.data.mod, made.data.attribute, made.data.tradition], [21, 11, "int", "Arcane"]);
  assert("the spell at the item's rank, with a use", [first.path, made.data.spells3[0].name, made.data.spells3[0].data.uses], ["data.spells.1.data.spells3.0", "Lightning Bolt", 1]);
  assert("its rank shown", [made.data.shownSpells, made.fields.spells3Box], [["spells3"], { hidden: false }]);
  assert("the character's own entries untouched", first.entries[0], pc.data.spells[0]);

  const leveled = character(first.entries);
  const again = ctx.getItemSpellEntries(leveled, LIGHTNING_BOLT, 3, { dc: 23, mod: 13, attribute: "int", tradition: "Arcane" });
  assert("the same spell again: the same row, so old cards still find it", [again.path, again.entries[1].data.spells3.length], ["data.spells.1.data.spells3.0", 1]);
  assert("the DC and attack refreshed (a level up)", [again.entries[1].data.dc, again.entries[1].data.mod], [23, 13]);
  const other = ctx.getItemSpellEntries(character(again.entries), HEAL, 1, { dc: 23, mod: 13, attribute: "wis", tradition: "Divine" });
  assert("another spell: its own row, one entry", [other.path, other.entries.length, other.entries[1].data.tradition], ["data.spells.1.data.spells1.0", 2, "Divine"]);
}

section("Using a wand or scroll from the sheet");
{
  records = {};
  reset();
  const pc = character([entry("Arcane Prepared Spells", { dc: 21, mod: 11 })], {}, [wand()]);
  ctx.record = pc;
  assert("handled", ctx.useItemSpell(pc, wand(), "data.inventory.0"), true);
  assert("the wand's use for the day is spent, the wand kept, in the same write as the entry", [sets, recordWrites.length, recordWrites[0]["data.inventory.0.data.uses.value"], Array.isArray(recordWrites[0]["data.spells"])], [[], 1, 0, true]);
  assertIncludes("chat says what is cast and with what", ctx.__state.messages[0], "**Ezren** casts Lightning Bolt (3rd rank) from Wand of Crackling Lightning (3rd-Rank Spell), with Arcane spell DC 21 and attack +11.");
  assert("the entry is written", recordWrites[0]["data.spells"][1].data.spells3[0]._id, "spell-lb");
  assert("castSpell casts it from there (found by name: the link has the module's id)", [casts[0].path, casts[0].spell._id, casts[0].spell.data.uses], ["data.spells.1.data.spells3.0", "spell-lb", 1]);

  reset();
  ctx.useItemSpell(pc, wand(0), "data.inventory.0");
  assert("spent today: nothing spent", sets, []);
  assertIncludes("a short overcharge line, and it still casts", ctx.__state.messages[0], "\n**Overcharge:** already used today (DC 10 flat check, GM Core pg. 282).");
  assert("cast", casts.length, 1);

  reset();
  const cleric = character([entry("Divine Prepared Spells", { tradition: "Divine", attribute: "wis", dc: 19, mod: 9 })], {}, [scroll()]);
  ctx.useItemSpell(cleric, scroll(2), "data.inventory.0");
  assert("a scroll is used up, in the same write", [sets, recordWrites[0]["data.inventory.0.data.count"]], [[], 1]);
  assertIncludes("cast at its rank with the cleric's DC", ctx.__state.messages[0], "casts Heal (1st rank) from Scroll of Heal (1st-Rank), with Divine spell DC 19");

  reset();
  assert("a potion: Use as before", ctx.useItemSpell(pc, potion, "data.inventory.1"), false);
  assert("an NPC: Use as before", ctx.useItemSpell({ ...pc, recordType: "npcs" }, wand(), "data.inventory.0"), false);
  assert("nothing written", [sets, recordWrites, casts], [[], [], []]);

  // useInventoryItem hands it over before posting the description
  reset();
  const savedGetValue = ctx.api.getValue;
  ctx.api.getValue = (path) => ctx.api.getValueOnRecord(pc, path);
  ctx.useInventoryItem("data.inventory.0");
  ctx.api.getValue = savedGetValue;
  assert("Use on the wand casts it", [casts.length, ctx.__state.messages.length], [1, 2 - 1]);
}

section("Trick Magic Item without the tradition: it just casts");
{
  // Player Core pg. 264: level as proficiency, the highest of Int/Wis/Cha
  const fighter = character([], { int: 1, wis: 2, cha: 0, arcana: 1, nature: 3 }, [wand()]);
  assert("trained: level 5 + Wis 2", ctx.getTrickMagicItemCasting(fighter, "arcana", "arcane"), { dc: 17, mod: 7, attribute: "wis", tradition: "Arcane" });
  assert("master in the skill: the trained bonus (level + 2)", ctx.getTrickMagicItemCasting(fighter, "nature", "primal").mod, 9);
  assert("legendary: the expert bonus (level + 4)", ctx.getTrickMagicItemCasting({ ...fighter, data: { ...fighter.data, nature: 4 } }, "nature", "primal").mod, 11);
  const wizard = character([entry("Arcane Prepared Spells", { dc: 22, mod: 12 })]);
  assert("a caster of another tradition: their own spell DC", ctx.getTrickMagicItemCasting(wizard, "religion", "divine"), { dc: 22, mod: 12, attribute: "int", tradition: "Divine" });

  // No check card and no second button: Use casts straight away, with the
  // tradition skill the fighter is best at (Nature for primal)
  reset();
  ctx.useItemSpell(fighter, wand(), "data.inventory.0");
  assertIncludes("cast with Trick Magic Item's numbers, and the card says so", ctx.__state.messages[0], "with Primal spell DC 19 and attack +9.\n*Trick Magic Item* (Player Core pg. 264)");
  assert("one card", ctx.__state.messages.length, 1);
  assert("the wand's use is spent, in the same write as the entry", [recordWrites.length, recordWrites[0]["data.inventory.0.data.uses.value"]], [1, 0]);
  assert("into the Scrolls and Wands entry", [casts[0].path, recordWrites[0]["data.spells"][0].data.dc], ["data.spells.0.data.spells3.0", 19]);
}

section("The entry stays out of slots, rest and the class's entries");
{
  const made = ctx.getItemSpellEntries(character([entry("Arcane Prepared Spells", { dc: 21 })]), LIGHTNING_BOLT, 3, { dc: 21, mod: 11, attribute: "int", tradition: "Arcane" }).entries;
  made[1].data.spells3[0].data.uses = 0;
  made[0].data.spells1 = [{ _id: "fb", name: "Force Barrage", data: { used: true } }];
  const pc = character(made, { curhp: 10, hitpoints: 40, con: 1 }, [wand(0), scroll(1), { ...potion, data: { ...potion.data, uses: { max: 1, value: 0 } } }]);

  // Daily preparations (characters-main.html's rest)
  const html = fs.readFileSync(`${__dirname}/../characters-main.html`, "utf8");
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], { filename: "characters-main.html" }).runInContext(ctx);
  }
  reset();
  ctx.record = pc;
  const savedGetValue = ctx.api.getValue;
  ctx.api.getValue = (path) => ctx.api.getValueOnRecord(pc, path);
  ctx.rest();
  ctx.api.getValue = savedGetValue;
  const rested = sets.find((values) => "data.curhp" in values) || {};
  assert("rest refills the wand's use", rested["data.inventory.0.data.uses.value"], 1);
  assert("not a potion's", rested["data.inventory.2.data.uses.value"], undefined);
  assert("rest leaves the Scrolls and Wands entry's rows alone", Object.keys(rested).filter((key) => key.startsWith("data.spells.1.")), []);
  assert("while the character's own prepared spells are reset", rested["data.spells.0.data.spells1.0.data.used"], false);

  // Recalculating entries and the class's entries
  const values = {};
  ctx.updateSpellcastingEntries(pc, values, JSON.parse(JSON.stringify(made)));
  assert("recalculating entries doesn't touch its DC", Object.keys(values).filter((key) => key.startsWith("data.spells.1.")), []);
  const synced = ctx.syncSpellcastingEntries({ ...pc, data: { ...pc.data, autoSpellcasting: true } }, {});
  assert("the class's entries keep it as it is", synced.find((e) => e.name === "Scrolls and Wands")?.data.dc, 21);
  assert("no focus points from it", ctx.getFocusPoolMax(pc), 0);
  assert("its spells aren't a focus entry's", ctx.getFocusSpellCount(made), 0);
  ctx.record = { data: {}, fields: {}, type: "characters", _id: "test" };
}

process.exitCode = summary() > 0 ? 1 : 0;
