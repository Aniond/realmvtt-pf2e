// Casting from scrolls and wands with the character's own spellcasting
// (GM Core pg. 262 Scrolls, pg. 282 Wands), and Trick Magic Item for a
// character without the spell's tradition (Player Core pg. 264).
//   - Use on a scroll or wand finds its spell (the item's Spell field, or the
//     spell its description links) and the rank (Level field, "(3rd-Rank
//     Spell)" in its name, or "at 3rd-rank" in its text);
//   - an automatic "Scrolls and Wands" entry (type item, data.itemSpells)
//     follows the inventory: a row per scroll and wand at the item's rank,
//     showing its uses and naming its item (data.itemSpell). It is brought
//     up to date when one is added, equipped, counted, deleted or used
//     (syncItemSpells), and left out of slots, daily preparations, level up
//     and the class's entries;
//   - a cast from a row (the entry, or Use on the item) spends that scroll or
//     wand in castSpell's one write, with the DC, attack, attribute and
//     tradition of the character's best entry of the spell's tradition,
//     worked out for that cast;
//   - without one, it casts with Trick Magic Item's DC and attack, and the
//     card says so; the GM asks for the check if the table wants it;
//   - a scroll is used up; a wand spends its once-a-day use, which comes back
//     at daily preparations (its row too). A spent wand still casts, with a
//     short overcharge line. Nothing here refuses a cast: the GM decides.
//   - staves and coda instruments (GM Core pg. 278; Treasure Vault pg. 136):
//     at daily preparations the character prepares one staff (charges equal
//     to their highest spell slot's rank, plus a prepared spell expended for
//     its rank). The prepared staff's spells (its list and its lower
//     versions') get rows at their ranks; a cast spends charges equal to the
//     rank (cantrips none), or for a spontaneous caster 1 charge and a slot
//     of that rank or higher. Not enough charges is a line on the card.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

const ITEM_SPELLS_ENTRY_NAME = "Scrolls and Wands";

// The skill each tradition's Trick Magic Item check uses
const TRADITION_SKILLS = {
  arcane: "arcana",
  divine: "religion",
  occult: "occultism",
  primal: "nature",
};

function getItemTraitNames(item) {
  return getTraitNameList(item?.data?.traits || []);
}

// "wand", "scroll", or null: by the wand or scroll trait, or Foundry's item
// category. Other consumables are left as they are.
function getItemSpellKind(item) {
  const traits = getItemTraitNames(item);
  const category = String(item?.data?.itemCategory || "").trim().toLowerCase();
  if (traits.includes("wand") || category === "wand") return "wand";
  if (traits.includes("scroll") || category === "scroll") return "scroll";
  // Magic staves and coda instruments have the staff trait (GM Core pg. 278,
  // Treasure Vault pg. 136)
  if (traits.includes("staff")) return "staff";
  return null;
}

// The spell a scroll or wand holds: { _id, name } from its Spell field, or
// the first spell its description links, or null
function getItemSpellRef(item) {
  const field = item?.data?.spell;
  if (field) {
    try {
      const ref = typeof field === "string" ? JSON.parse(field) : field;
      if (ref?._id || ref?.name) return { _id: ref._id || "", name: ref.name || "" };
    } catch (e) {
      // not JSON: fall through to the description
    }
  }
  const description = String(item?.data?.description || "").replace(/&quot;/g, '"');
  const pattern = /recordlink="(\{.*?\})"/g;
  for (const match of description.matchAll(pattern)) {
    try {
      const link = JSON.parse(match[1]);
      const value = link?.value || {};
      if (value.recordType === "spells" && (value._id || value.name)) {
        return { _id: value._id || "", name: value.name || "" };
      }
    } catch (e) {
      // a link we can't read
    }
  }
  return null;
}

// The rank the item casts at, or null for the spell's own: the Level field,
// "(3rd-Rank Spell)" in its name, or "at 3rd-rank" in its text (legacy:
// level)
function getItemSpellRank(item) {
  const field = parseInt(item?.data?.spellLevel, 10);
  if (field > 0) return field;
  const pattern = /(\d+)(?:st|nd|rd|th)[- ](?:rank|level)/i;
  const fromName = String(item?.name || "").match(pattern);
  if (fromName) return parseInt(fromName[1], 10);
  const fromText = String(item?.data?.description || "").match(pattern);
  return fromText ? parseInt(fromText[1], 10) : null;
}

// The traditions that have the spell: its traditions, or tradition traits
function getSpellTraditions(spell) {
  const names = [
    ...(Array.isArray(spell?.data?.traditions) ? spell.data.traditions : []),
    ...(spell?.data?.traits || []),
  ].map((name) => String(typeof name === "string" ? name : name?.name || "").trim().toLowerCase());
  return Object.keys(TRADITION_SKILLS).filter((tradition) => names.includes(tradition));
}

function isItemSpellsEntry(entry) {
  return entry?.data?.itemSpells === true || entry?.data?.itemSpells === "true";
}

// A character's prepared and spontaneous entries (not focus, innate or
// item), with their index
function getCastingEntries(record) {
  return (record?.data?.spells || [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const type = entry?.data?.type || "prepared";
      return (type === "prepared" || type === "spontaneous") && !isItemSpellsEntry(entry);
    });
}

// Whether an entry already lists the spell (a sorcerer's bloodline spells,
// whatever the entry's tradition)
function entryListsSpell(entry, spell) {
  const name = String(spell?.name || "").trim().toLowerCase();
  return SPELL_RANK_LISTS.some((list) =>
    (entry?.data?.[list] || []).some(
      (row) => (spell?._id && row?._id === spell._id) || (name && String(row?.name || "").trim().toLowerCase() === name),
    ),
  );
}

// The character's best entry (highest DC) of one of the traditions, or one
// that already lists the spell (Foundry's canCast: matchesTradition ||
// isInSpellList), or null
function getBestCastingEntry(record, traditions, spell = null) {
  const matching = getCastingEntries(record).filter(
    ({ entry }) =>
      traditions.includes(String(entry?.data?.tradition || "").trim().toLowerCase()) ||
      (spell && entryListsSpell(entry, spell)),
  );
  matching.sort((a, b) => (parseInt(b.entry.data?.dc, 10) || 0) - (parseInt(a.entry.data?.dc, 10) || 0));
  return matching[0]?.entry || null;
}

// The DC and attack Trick Magic Item casts with (Player Core pg. 264), for
// everyone, casters of another tradition too (Foundry's
// TrickMagicItemEntry): the level as the proficiency bonus (trained's if
// master in the skill, expert's if legendary) and the highest of Int, Wis
// and Cha
function getTrickMagicItemCasting(record, skill, tradition) {
  const level = parseInt(record?.data?.level, 10) || 1;
  const rank = parseInt(record?.data?.[skill] || "0", 10) || 0;
  const proficiency = level + (rank >= 4 ? 4 : rank >= 3 ? 2 : 0);
  const attributes = ["int", "wis", "cha"].map((attribute) => ({
    attribute,
    value: parseInt(record?.data?.[attribute] || "0", 10) || 0,
  }));
  attributes.sort((a, b) => b.value - a.value);
  const mod = proficiency + attributes[0].value;
  return { dc: 10 + mod, mod, attribute: attributes[0].attribute, tradition: capitalize(tradition) };
}

// The caster's numbers for a scroll's or wand's spell: their best entry of
// its tradition, or Trick Magic Item's with the tradition skill they're best
// at: { casting: { dc, mod, attribute, tradition }, note }
function getItemSpellCasting(record, spell) {
  const traditions = getSpellTraditions(spell);
  const best = getBestCastingEntry(record, traditions, spell);
  if (best) {
    return {
      casting: {
        dc: parseInt(best.data?.dc, 10) || 0,
        mod: parseInt(best.data?.mod, 10) || 0,
        attribute: best.data?.attribute || "int",
        tradition: best.data?.tradition || capitalize(traditions[0] || "arcane"),
      },
      note: "",
    };
  }
  const options = traditions.length ? traditions : Object.keys(TRADITION_SKILLS);
  const tradition = options.slice().sort(
    (a, b) =>
      (parseInt(record?.data?.[TRADITION_SKILLS[b]] || "0", 10) || 0) -
      (parseInt(record?.data?.[TRADITION_SKILLS[a]] || "0", 10) || 0),
  )[0];
  return {
    casting: getTrickMagicItemCasting(record, TRADITION_SKILLS[tradition], tradition),
    note: "*Trick Magic Item* (Player Core pg. 264)",
  };
}

// The scrolls and wands in the inventory that hold a spell, whether carried,
// equipped or dropped, and each spell of a prepared staff:
// [{ item, index, kind, ref, rank }] (rank: a staff spell's)
function getInventoryItemSpells(record) {
  return (record?.data?.inventory || []).flatMap((item, index) => {
    const kind = getItemSpellKind(item);
    if (kind === "staff") {
      return getPreparedStaffSpells(item).map((ref) => ({ item, index, kind, ref, rank: ref.rank }));
    }
    const ref = kind ? getItemSpellRef(item) : null;
    return ref ? [{ item, index, kind, ref }] : [];
  });
}

// What a row shows as its uses: a wand's use for the day, or how many
// scrolls are left
function getItemSpellRowUses(item, kind) {
  // A staff's rows show its charges (item-spells.js, staves)
  if (kind === "wand" || kind === "staff") {
    return {
      uses: parseInt(item?.data?.uses?.value, 10) || 0,
      maxUses: parseInt(item?.data?.uses?.max, 10) || 0,
    };
  }
  const count = parseInt(item?.data?.count, 10) || 0;
  return { uses: count, maxUses: count };
}

// A row of the Scrolls and Wands entry for one scroll or wand: its spell,
// its uses, and which item it is (data.itemSpell), so a cast from the row
// spends that item
function buildItemSpellRow(item, index, kind, spell, rank = null) {
  // A staff has a row per spell and rank
  const staffKey = kind === "staff" ? `-${getStaffSpellSlug(spell.name)}-${rank}` : "";
  return {
    _id: `itemspell-${item?._id || index}${staffKey}`,
    name: spell.name,
    portrait: spell.portrait,
    recordType: "spells",
    data: {
      type: "spell",
      ...(spell.data || {}),
      ...getItemSpellRowUses(item, kind),
      itemSpell: {
        itemId: item?._id || "",
        itemIndex: index,
        itemName: item?.name || "",
        kind,
        spellId: spell._id || "",
        ...(kind === "staff" ? { rank } : {}),
      },
    },
    fields: {
      spellDetails: { hidden: false },
      spellSlot: { hidden: true },
      nameBox: { hidden: false },
      nameUsedBox: { hidden: true },
      innateBox: { hidden: false },
      signatureBox: { hidden: true },
      used: { hidden: true },
      // A row goes when its item does, so it has no delete of its own
      deleteBtn: { hidden: true },
    },
  };
}

// The spell a row was made from, to make the row again without looking it
// up
function getItemSpellFromRow(row) {
  const { uses, maxUses, itemSpell, ...data } = row?.data || {};
  return { _id: itemSpell?.spellId || "", name: row?.name, portrait: row?.portrait, data };
}

// Which scroll or wand a spell was found for: its id (its index if it has
// none), so a spell found before a read still matches the item after it
function getItemSpellKey(item, index) {
  return item?._id || `#${index}`;
}

// The key of one of getInventoryItemSpells' entries: the item's, and for a
// staff, its spell and rank too
function getItemSpellEntryKey({ item, index, kind, ref, rank }) {
  const key = getItemSpellKey(item, index);
  return kind === "staff" ? `${key}|${String(ref?.name || "").trim().toLowerCase()}|${rank}` : key;
}

// The Scrolls and Wands entry as the inventory has it, given each item's
// spell ({ [getItemSpellKey]: spell }): a row per scroll and wand at the
// item's rank, and the caster's numbers for the first one (every cast works
// them out again for its own spell). null when there are none.
function buildItemSpellsEntry(record, spellsByItem) {
  const listed = getInventoryItemSpells(record).filter((found) => spellsByItem[getItemSpellEntryKey(found)]);
  if (listed.length === 0) return null;
  const entries = record?.data?.spells || [];
  const current =
    entries.find(isItemSpellsEntry) ||
    buildSpellcastingEntry({
      name: ITEM_SPELLS_ENTRY_NAME,
      type: "item",
      shownSpells: [],
      isFirst: entries.length === 0,
    });
  const data = { ...current.data, type: "item", itemSpells: true };
  const fields = { ...(current.fields || {}) };
  SPELL_RANK_LISTS.forEach((list) => {
    data[list] = [];
  });
  listed.forEach((found) => {
    const { item, index, kind } = found;
    const spell = spellsByItem[getItemSpellEntryKey(found)];
    // A staff's spell at its rank on the staff's list (0: a cantrip)
    if (kind === "staff") {
      const list = found.rank > 0 ? `spells${Math.min(10, found.rank)}` : "cantrips";
      data[list].push(buildItemSpellRow(item, index, kind, spell, found.rank));
      return;
    }
    const rank = Math.min(10, getItemSpellRank(item) || parseInt(spell?.data?.level, 10) || 1);
    data[`spells${rank}`].push(buildItemSpellRow(item, index, kind, spell));
  });
  data.shownSpells = SPELL_RANK_LISTS.filter((list) => data[list].length > 0);
  SPELL_RANK_LISTS.forEach((list) => {
    if (data[list].length > 0 || fields[`${list}Box`]) {
      fields[`${list}Box`] = { hidden: data[list].length === 0 };
    }
  });
  const first = listed[0];
  Object.assign(data, getItemSpellCasting(record, spellsByItem[getItemSpellEntryKey(first)]).casting);
  return { ...current, data, fields };
}

// The spell's record: by id, then by name (a description links the module's
// spell, and the campaign's copy has another id)
function findItemSpell(ref, callback) {
  const byName = () => {
    if (!ref?.name) return callback(null);
    api.getRecordByTypeAndName("spells", ref.name, (spell) => callback(spell || null));
  };
  if (!ref?._id) return byName();
  api.getRecord("spells", ref._id, (spell) => (spell ? callback(spell) : byName()));
}

// Brings the Scrolls and Wands entry in line with the inventory, when a
// scroll or wand is added, equipped, counted or deleted: a row for each one
// with a spell, none for one that's gone, and no entry when there are none.
// callback(record) gets the record read after.
// Realm runs every click as a script of its own, so two syncs can overlap
// (two quick deletes, or two clients) and nothing here can wait for the
// other. Each one writes against a record it has just read, and only what
// changed:
//   - the spells it has to look up take round trips, so it reads again after
//     them and builds from that read (the spells are kept by item id);
//   - it removes by id (removeValueFromRecord on the record it read), so two
//     syncs removing the entry at once remove it once;
//   - two adding it at once can leave two entries: each reads again after
//     its write and removes any but the first (by id, so both doing it
//     remove the extra once).
function syncItemSpells(record, callback) {
  const done = (updated) => {
    if (callback) callback(updated);
  };
  if (record?.recordType !== "characters") return done(record);
  const read = (then) => rereadItemSpells(record, then);
  read((current) => {
    const items = getInventoryItemSpells(current);
    if (items.length === 0 && !(current.data?.spells || []).some(isItemSpellsEntry)) return done(current);

    // A row already made for the same item and spell keeps its spell; only
    // the others are looked up
    const entry = (current.data?.spells || []).find(isItemSpellsEntry);
    const rows = SPELL_RANK_LISTS.flatMap((list) => entry?.data?.[list] || []);
    const spellsByItem = {};
    const missing = [];
    items.forEach((found) => {
      const { item, ref, kind, rank } = found;
      const row = rows.find(
        (r) =>
          r?.data?.itemSpell?.itemId === (item._id || "") &&
          String(r?.name || "").trim().toLowerCase() === String(ref.name || "").trim().toLowerCase() &&
          (kind !== "staff" || r?.data?.itemSpell?.rank === rank),
      );
      if (row) spellsByItem[getItemSpellEntryKey(found)] = getItemSpellFromRow(row);
      else missing.push(found);
    });
    if (missing.length === 0) return writeItemSpells(current, spellsByItem, done);
    let pending = missing.length;
    missing.forEach((found) =>
      findItemSpell(found.ref, (spell) => {
        if (spell) spellsByItem[getItemSpellEntryKey(found)] = spell;
        pending -= 1;
        if (pending === 0) read((latest) => writeItemSpells(latest, spellsByItem, done));
      }),
    );
  });
}

// The character read again, for after a write (its callback can hand back
// the copy from before)
function rereadItemSpells(record, then) {
  api.getRecord(record.recordType, record._id, (fresh) => then(fresh || record));
}

// syncItemSpells' one write against the record just read: the entry added,
// set or removed, or nothing when it's as it should be. done(record) gets
// the record after, read again when something was written.
function writeItemSpells(current, spellsByItem, done) {
  const entries = current.data?.spells || [];
  const entryIndex = entries.findIndex(isItemSpellsEntry);
  const entry = buildItemSpellsEntry(current, spellsByItem);
  const written = () => rereadItemSpells(current, (after) => removeItemSpellsEntries(after, 1, done));
  if (!entry) {
    // None left: every Scrolls and Wands entry goes
    removeItemSpellsEntries(current, 0, done);
  } else if (entryIndex < 0) {
    api.addValuesToRecord(current, "data.spells", [entry], written);
  } else if (JSON.stringify(entry) === JSON.stringify(entries[entryIndex])) {
    removeItemSpellsEntries(current, 1, done);
  } else {
    api.setValuesOnRecord(current, { [`data.spells.${entryIndex}`]: entry }, written);
  }
}

// Removes the Scrolls and Wands entries after the first `keep` (1: a second
// one, from two syncs adding it at once; 0: all), by id, from the last so the
// indexes before it hold; then done(record), read again if one was removed
function removeItemSpellsEntries(record, keep, done) {
  const extras = (record.data?.spells || [])
    .map((entry, index) => (isItemSpellsEntry(entry) ? index : -1))
    .filter((index) => index >= 0)
    .slice(keep)
    .reverse();
  if (extras.length === 0) return done(record);
  const next = () => {
    if (extras.length === 0) return rereadItemSpells(record, done);
    api.removeValueFromRecord(record, "data.spells", extras.shift(), next);
  };
  next();
}

// Whether the inventory has anything for the Scrolls and Wands entry, or the
// entry is there to tidy up (so other characters skip the read)
function hasItemSpells(record) {
  return getInventoryItemSpells(record).length > 0 || (record?.data?.spells || []).some(isItemSpellsEntry);
}

// The scroll or wand a row was made from: by its index while the item there
// is the same one, else by its id, else (a row from before rows knew their
// item) the first scroll or wand with the spell. { item, index, kind, ref }
// or null.
function findItemSpellItem(record, itemSpell, spellName) {
  const items = getInventoryItemSpells(record);
  const byIndex = items.find(({ item, index }) => index === itemSpell?.itemIndex && (item._id || "") === itemSpell?.itemId);
  if (byIndex) return byIndex;
  if (itemSpell?.itemId) {
    const byId = items.find(({ item }) => item._id === itemSpell.itemId);
    if (byId) return byId;
  }
  const name = String(spellName || "").trim().toLowerCase();
  return items.find(({ ref }) => String(ref.name || "").trim().toLowerCase() === name) || null;
}

// The values that spend a scroll (one fewer) or a wand's use for the day,
// and the card's line for an overcharge, or "": { values, line, left,
// destroy, bulk }. A scroll at 0 that auto-destroys is removed (destroy).
function getItemSpellUseValues(item, itemPath, kind, rank = 0, payment = null, record = null) {
  if (kind === "staff") return getStaffChargeValues(item, itemPath, rank, payment, record);
  if (kind === "wand") {
    const left = parseInt(item?.data?.uses?.value, 10);
    if (left > 0) {
      return { values: { [`${itemPath}.data.uses.value`]: left - 1 }, line: "", left: left - 1 };
    }
    return {
      values: {},
      line: "**Overcharge:** already used today (DC 10 flat check, GM Core pg. 282).",
      left: 0,
    };
  }
  const count = Math.max(0, (parseInt(item?.data?.count, 10) || 0) - 1);
  const autoDestroy = item?.data?.uses?.autoDestroy === true || item?.data?.uses?.autoDestroy === "true";
  return {
    values: { [`${itemPath}.data.count`]: count },
    line: "",
    left: count,
    destroy: count <= 0 && autoDestroy,
    bulk: true,
  };
}

// For castSpell, a cast from the Scrolls and Wands entry: the caster's
// numbers for this spell, written to the entry, and the row's scroll or wand
// spent, all in castSpell's one write. Never refuses (a spent wand
// overcharges). An overlay is part of a cast already made, so it spends
// nothing. { entry, values, lines, use }
function getItemSpellCast(record, spell, rowPath, entryPath, isOverlay = false) {
  const entry = api.getValueOnRecord(record, entryPath) || {};
  if (isOverlay) return { entry, values: {}, lines: [], use: {} };
  const { casting, note } = getItemSpellCasting(record, spell);
  const values = {};
  Object.entries(casting).forEach(([key, value]) => {
    values[`${entryPath}.data.${key}`] = value;
  });
  const found = findItemSpellItem(record, spell?.data?.itemSpell, spell?.name);
  let use = {};
  let itemName = spell?.data?.itemSpell?.itemName || ITEM_SPELLS_ENTRY_NAME;
  if (found) {
    itemName = found.item.name || itemName;
    use = {
      ...getItemSpellUseValues(
        found.item,
        `data.inventory.${found.index}`,
        found.kind,
        parseInt(spell?.data?.itemSpell?.rank, 10) || 0,
        spell?.staffPayment || null,
        record,
      ),
      itemIndex: found.index,
      itemId: found.item._id || "",
    };
    Object.assign(values, use.values);
    values[`${rowPath}.data.uses`] = use.left;
    // Every row of a staff shows its charges
    if (found.kind === "staff") {
      Object.assign(values, getStaffRowUsesValues(entry, entryPath, found.item._id || "", use.left));
    }
  }
  const lines = [
    `*From ${itemName}: ${casting.tradition} spell DC ${casting.dc}, attack +${casting.mod}*`,
    note,
    found ? use.line : `*${itemName} is no longer in the inventory.*`,
  ].filter(Boolean);
  return { entry: { ...entry, data: { ...(entry.data || {}), ...casting } }, values, lines, use };
}

// After castSpell's write: a used-up scroll is removed when it auto-destroys,
// as other consumables are, and its row with it; then bulk is worked out
// again. It reads the record first and removes the scroll by its id
// (removeValueFromRecord on that read), only while it's there and used up:
// a double click's two casts remove it once, and never what moved into its
// place.
function finishItemSpellCast(record, use) {
  if (!use?.bulk) return;
  const recalc = (updated) => updateTotalBulk(updated || record, true, true);
  api.getRecord(record.recordType, record._id, (fresh) => {
    const current = fresh || record;
    if (!use.destroy) return recalc(current);
    const inventory = current.data?.inventory || [];
    const index = use.itemId
      ? inventory.findIndex((item) => item?._id === use.itemId)
      : inventory[use.itemIndex] && getItemSpellKind(inventory[use.itemIndex]) === "scroll" ? use.itemIndex : -1;
    const usedUp = index >= 0 && (parseInt(inventory[index].data?.count, 10) || 0) <= 0;
    if (!usedUp) return syncItemSpells(current, recalc);
    api.removeValueFromRecord(current, "data.inventory", index, () => syncItemSpells(current, recalc));
  });
}

// The path of the row for the inventory item (by its id, else its index), or
// null
function getItemSpellRowPath(record, itemIndex, itemId = "") {
  const entries = record?.data?.spells || [];
  const entryIndex = entries.findIndex(isItemSpellsEntry);
  if (entryIndex < 0) return null;
  const isRow = (row) => (itemId ? row?.data?.itemSpell?.itemId === itemId : row?.data?.itemSpell?.itemIndex === itemIndex);
  for (const list of SPELL_RANK_LISTS) {
    const rowIndex = (entries[entryIndex].data?.[list] || []).findIndex(isRow);
    if (rowIndex >= 0) return `data.spells.${entryIndex}.data.${list}.${rowIndex}`;
  }
  return null;
}

// Use on a scroll or wand from the sheet: brings the Scrolls and Wands entry
// up to date and casts the item's row, as a cast from the entry does.
// Returns false for anything else (or a creature that isn't a character),
// which Use handles as before.
function useItemSpell(record, item, itemPath) {
  const kind = getItemSpellKind(item);
  const ref = kind ? getItemSpellRef(item) : null;
  if (!ref || record?.recordType !== "characters") return false;
  const itemIndex = parseInt(String(itemPath).split(".").pop(), 10);
  syncItemSpells(record, (current) => {
    const path = getItemSpellRowPath(current, itemIndex, item._id || "");
    if (!path) {
      api.showNotification(`The spell in ${item.name} (${ref.name}) wasn't found.`, "yellow", item.name);
      return;
    }
    castSpell(current, api.getValueOnRecord(current, path), path);
  });
  return true;
}

// The values that bring wands' daily uses back (daily preparations), with
// their rows in the Scrolls and Wands entry showing it
function getWandRecharges(record) {
  const values = {};
  (record?.data?.inventory || []).forEach((item, index) => {
    if (getItemSpellKind(item) !== "wand") return;
    const max = parseInt(item?.data?.uses?.max, 10) || 0;
    if (max > 0 && (parseInt(item?.data?.uses?.value, 10) || 0) < max) {
      values[`data.inventory.${index}.data.uses.value`] = max;
    }
  });
  const entries = record?.data?.spells || [];
  const entryIndex = entries.findIndex(isItemSpellsEntry);
  if (entryIndex < 0) return values;
  SPELL_RANK_LISTS.forEach((list) => {
    (entries[entryIndex].data?.[list] || []).forEach((row, rowIndex) => {
      const found = findItemSpellItem(record, row?.data?.itemSpell, row?.name);
      if (found?.kind !== "wand") return;
      const key = `data.inventory.${found.index}.data.uses.value`;
      const uses = key in values ? values[key] : parseInt(found.item.data?.uses?.value, 10) || 0;
      if (row.data?.uses !== uses) {
        values[`data.spells.${entryIndex}.data.${list}.${rowIndex}.data.uses`] = uses;
      }
    });
  });
  return values;
}

// ---------------------------------------------------------------- Staves

// Staves (GM Core pg. 278) and coda instruments (Treasure Vault pg. 136,
// staves a bard prepares):
//   - Preparing a staff at daily preparations gives it charges equal to the
//     rank of the character's highest spell slot. A prepared caster can
//     expend one prepared spell to add its rank. Preparing one removes the
//     charges any staff had (they last 24 hours), and only one is prepared
//   - The prepared staff keeps its spells (data.staffSpells, its list and
//     its lower versions': a greater staff lists only what it adds), and
//     the Scrolls and Wands entry has a row for each at its rank
//   - Casting one spends charges equal to the rank (cantrips none). A
//     spontaneous caster can pay 1 charge and a slot of that rank or higher
//     instead (asked first). Not enough charges is a line on the card; the
//     cast goes ahead, as every item cast here does

// A greater staff holds its lower versions' spells too
const STAFF_VERSION_GRADES = ["", "Greater", "Major", "True"];

// A spell's name as the records have it, from a staff's italic text
// ("gouging claw" -> "Gouging Claw", "wall of fire" -> "Wall of Fire")
const STAFF_SPELL_NAME_SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

function getStaffSpellTitle(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) =>
      i > 0 && STAFF_SPELL_NAME_SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

// The spells a staff's description lists, by rank: [{ _id, name, rank }]
// (rank 0: a cantrip). The GM Core module lists them as
// <li><strong>1st</strong> and the spells' links; the Treasure Vault module
// as italic names (<em>gouging claw</em>), looked up by name
function getStaffDescriptionSpells(item) {
  const description = String(item?.data?.description || "").replace(/&quot;/g, '"');
  const spells = [];
  for (const entry of description.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const label = (entry[1].match(/<strong>\s*([^<]*?)\s*<\/strong>/i)?.[1] || "").trim();
    const rank = /^cantrips?$/i.test(label) ? 0 : parseInt(label, 10);
    if (!(rank >= 0 && rank <= 10)) continue;
    const before = spells.length;
    for (const link of entry[1].matchAll(/recordlink="(\{.*?\})"/g)) {
      try {
        const value = JSON.parse(link[1])?.value || {};
        if (value.recordType === "spells" && (value._id || value.name)) {
          spells.push({ _id: value._id || "", name: value.name || "", rank });
        }
      } catch (e) {
        // a link we can't read
      }
    }
    if (spells.length > before) continue;
    for (const named of entry[1].matchAll(/<em>([\s\S]*?)<\/em>/gi)) {
      const name = getStaffSpellTitle(named[1].replace(/<[^>]+>/g, ""));
      if (name) spells.push({ _id: "", name, rank });
    }
  }
  return spells;
}

// The names of a staff's lower versions: "Beast Staff (Major)" -> "Beast
// Staff", "Beast Staff (Greater)"
function getStaffVersionNames(name) {
  const match = String(name || "").match(/^(.*?) \((Greater|Major|True)\)$/);
  if (!match) return [];
  return STAFF_VERSION_GRADES.slice(0, STAFF_VERSION_GRADES.indexOf(match[2])).map((grade) =>
    grade ? `${match[1]} (${grade})` : match[1],
  );
}

// Spells merged, one per spell and rank, by rank then name
function mergeStaffSpells(lists) {
  const seen = new Set();
  return lists
    .flat()
    .filter((spell) => {
      const key = `${String(spell.name || "").trim().toLowerCase()}|${spell.rank}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name)));
}

// A staff's spells with its lower versions' (looked up by name), then
// callback(spells)
function getStaffSpells(item, callback) {
  const names = getStaffVersionNames(item?.name);
  const lists = [getStaffDescriptionSpells(item)];
  const next = () => {
    if (names.length === 0) return callback(mergeStaffSpells(lists));
    api.getRecordByTypeAndName("items", names.shift(), (version) => {
      if (version) lists.push(getStaffDescriptionSpells(version));
      next();
    });
  };
  next();
}

// The spells of a staff prepared today, or none
function getPreparedStaffSpells(item) {
  const spells = item?.data?.staffSpells;
  return Array.isArray(spells) ? spells.filter((spell) => spell?.name) : [];
}

function getStaffSpellSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// The charges a cast from a staff spends (GM Core pg. 278): its rank, or 1
// with a spontaneous caster's slot (payment: { entryIndex, slotRank }). Not
// enough charges spends nothing, with a line. { values, line, left }
function getStaffChargeValues(item, itemPath, rank, payment = null, record = null) {
  const left = parseInt(item?.data?.uses?.value, 10) || 0;
  if (rank <= 0) return { values: {}, line: "", left };
  const cost = payment?.slotRank ? 1 : rank;
  if (left < cost) {
    return {
      values: {},
      line: `**Not enough charges:** ${item?.name || "the staff"} has ${left}; this spell takes ${cost}.`,
      left,
    };
  }
  const values = { [`${itemPath}.data.uses.value`]: left - cost };
  let paid = `${cost} charge${cost === 1 ? "" : "s"}`;
  if (payment?.slotRank) {
    const entry = record?.data?.spells?.[payment.entryIndex];
    const slots = parseInt(entry?.data?.[`usedSpells${payment.slotRank}`], 10) || 0;
    values[`data.spells.${payment.entryIndex}.data.usedSpells${payment.slotRank}`] = Math.max(0, slots - 1);
    paid += ` and a ${getOrdinal(payment.slotRank)}-rank slot (${entry?.name || "spontaneous"})`;
  }
  return { values, line: `*${paid}: ${left - cost} left.*`, left: left - cost };
}

// Every row of a staff shows its charges: the values for the rows that
// change
function getStaffRowUsesValues(entry, entryPath, itemId, left) {
  const values = {};
  SPELL_RANK_LISTS.forEach((list) => {
    (entry?.data?.[list] || []).forEach((row, rowIndex) => {
      if (row?.data?.itemSpell?.kind === "staff" && row.data.itemSpell.itemId === itemId && row.data.uses !== left) {
        values[`${entryPath}.data.${list}.${rowIndex}.data.uses`] = left;
      }
    });
  });
  return values;
}

// A spontaneous caster's slots that can pay for a staff spell of the rank:
// the same rank or higher, with one left
function getStaffSlotOptions(record, rank) {
  return getCastingEntries(record)
    .filter(({ entry }) => entry?.data?.type === "spontaneous")
    .flatMap(({ entry, index }) => {
      const options = [];
      for (let slotRank = rank; slotRank <= 10; slotRank++) {
        const left = parseInt(entry.data?.[`usedSpells${slotRank}`], 10) || 0;
        if (left > 0) options.push({ entryIndex: index, entryName: entry.name, slotRank, left });
      }
      return options;
    });
}

// castSpell's first step for a staff's spell: a spontaneous caster with a
// slot picks charges or 1 charge and a slot, then it casts again with that
// (staffPayment). Returns true when it asked.
function promptStaffPayment(record, spell, dataPathToSpell, isOverlay) {
  if (isOverlay || spell?.staffPayment) return false;
  const itemSpell = spell?.data?.itemSpell;
  const rank = parseInt(itemSpell?.rank, 10) || 0;
  if (itemSpell?.kind !== "staff" || rank <= 1) return false;
  const slots = getStaffSlotOptions(record, rank);
  if (slots.length === 0) return false;
  api.showPrompt(
    `Cast ${spell.name} from ${itemSpell.itemName || "the staff"}`,
    "A spontaneous caster can pay with 1 charge and one of their spell slots (GM Core pg. 278).",
    "Select...",
    [
      { label: `${rank} charges`, value: "charges" },
      ...slots.map((slot) => ({
        label: `1 charge and a ${getOrdinal(slot.slotRank)}-rank slot (${slot.entryName}, ${slot.left} left)`,
        value: `${slot.entryIndex}:${slot.slotRank}`,
      })),
    ],
    null,
    (selected) => {
      const choice = getPromptSelections(selected)[0];
      if (!choice) return;
      const [entryIndex, slotRank] = choice === "charges" ? [] : choice.split(":").map((part) => parseInt(part, 10));
      const staffPayment = choice === "charges" ? { charges: true } : { entryIndex, slotRank };
      castSpell(record, { ...spell, staffPayment }, dataPathToSpell, isOverlay);
    },
    "Cast",
    "Cancel",
    1,
  );
  return true;
}

// The rank of the character's highest spell slot, in any prepared or
// spontaneous entry
function getHighestSpellSlotRank(record) {
  let highest = 0;
  getCastingEntries(record).forEach(({ entry }) => {
    for (let rank = 1; rank <= 10; rank++) {
      if ((parseInt(entry?.data?.[`numSpells${rank}`], 10) || 0) > 0) highest = Math.max(highest, rank);
    }
  });
  return highest;
}

// The character's staves and coda instruments: [{ item, index }]
function getInventoryStaves(record) {
  return (record?.data?.inventory || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => getItemSpellKind(item) === "staff");
}

// A prepared caster's prepared spells not cast yet, to expend into a staff:
// [{ label, value, rank, path }]
function getStaffExpendOptions(record) {
  return getCastingEntries(record)
    .filter(({ entry }) => (entry?.data?.type || "prepared") === "prepared")
    .flatMap(({ entry, index }) =>
      SPELL_RANK_LISTS.slice(1).flatMap((list, listIndex) =>
        (entry.data?.[list] || [])
          .map((row, rowIndex) => ({ row, rowIndex }))
          .filter(({ row }) => row?.name && row.data?.used !== true)
          .map(({ row, rowIndex }) => ({
            label: `${row.name} (${getOrdinal(listIndex + 1)} rank, ${entry.name})`,
            value: `data.spells.${index}.data.${list}.${rowIndex}`,
            rank: listIndex + 1,
          })),
      ),
    );
}

// The one write that prepares a staff (or none: staffId null): its charges
// and spells, every other staff's charges gone, and the prepared spell
// expended into it (expend: one of getStaffExpendOptions, or null)
function getStaffPreparationValues(record, staffId, spells, expend = null) {
  const charges = staffId ? getHighestSpellSlotRank(record) + (expend?.rank || 0) : 0;
  const values = {};
  getInventoryStaves(record).forEach(({ item, index }) => {
    const path = `data.inventory.${index}.data`;
    if (item._id === staffId) {
      values[`${path}.uses.value`] = charges;
      values[`${path}.uses.max`] = charges;
      values[`${path}.staffSpells`] = spells;
    } else if ((parseInt(item.data?.uses?.value, 10) || 0) > 0 || getPreparedStaffSpells(item).length > 0) {
      values[`${path}.uses.value`] = 0;
      values[`${path}.staffSpells`] = [];
    }
  });
  if (staffId && expend) {
    values[`${expend.value}.data.used`] = true;
    values[`${expend.value}.fields.nameUsedBox.hidden`] = false;
    values[`${expend.value}.fields.nameBox.hidden`] = true;
  }
  return { values, charges };
}

function isBardCharacter(record) {
  return (record?.data?.classes || []).some((cls) => /^bard\b/i.test(cls?.name || ""));
}

// Daily preparations: which staff to prepare (charges for the highest spell
// slot), and for a prepared caster a prepared spell to expend into it; then
// the write, the Scrolls and Wands entry brought up to date, and next()
function promptStaffPreparation(recordId, next) {
  const finish = () => {
    if (next) next();
  };
  api.getRecord("characters", recordId, (record) => {
    const staves = record ? getInventoryStaves(record) : [];
    const highest = record ? getHighestSpellSlotRank(record) : 0;
    if (staves.length === 0 || highest === 0) return finish();
    const write = (staffId, spells, expend) => {
      const { values, charges } = getStaffPreparationValues(record, staffId, spells, expend);
      if (Object.keys(values).length === 0) return finish();
      api.setValuesOnRecord(record, values, (updated) => {
        syncItemSpells(updated || record, () => {
          const staff = staves.find(({ item }) => item._id === staffId)?.item;
          if (staff) {
            const extra = expend ? `, ${expend.rank} from expending ${expend.label}` : "";
            api.sendMessage(
              `**${getCreatureName(record)} prepares ${staff.name}:** ${charges} charge${charges === 1 ? "" : "s"} (${highest} for their highest spell slot${extra}), and ${spells.length} spell${spells.length === 1 ? "" : "s"} to cast from it.`,
            );
          }
          finish();
        });
      });
    };
    const coda = (item) => itemHasTrait(item, "coda") && !isBardCharacter(record);
    api.showPrompt(
      "Prepare a Staff",
      `A staff you prepare gains ${highest} charge${highest === 1 ? "" : "s"} (your highest spell slot's rank). Only one staff a day; charges from before are lost.`,
      "Select...",
      [
        { label: "Don't prepare a staff", value: "none" },
        ...staves.map(({ item }) => ({
          label: coda(item) ? `${item.name} (a coda instrument: bards prepare these)` : item.name,
          value: item._id,
        })),
      ],
      null,
      (selected) => {
        const choice = getPromptSelections(selected)[0];
        if (!choice || choice === "none") return write(null, [], null);
        const staff = staves.find(({ item }) => item._id === choice)?.item;
        if (!staff) return finish();
        const prepare = (expend) => getStaffSpells(staff, (spells) => write(staff._id, spells, expend));
        const options = getStaffExpendOptions(record);
        if (options.length === 0) return prepare(null);
        api.showPrompt(
          "Prepare a Staff",
          "A prepared spellcaster can expend one prepared spell to add charges equal to its rank.",
          "Select...",
          [{ label: "Don't expend a spell", value: "none" }, ...options.map(({ label, value }) => ({ label, value }))],
          null,
          (picked) => {
            const value = getPromptSelections(picked)[0];
            prepare(options.find((option) => option.value === value) || null);
          },
          "OK",
          "Skip",
          1,
        );
      },
      "Prepare",
      "Skip",
      1,
    );
  });
}
