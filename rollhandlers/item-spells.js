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
// equipped or dropped: [{ item, index, kind, ref }]
function getInventoryItemSpells(record) {
  return (record?.data?.inventory || [])
    .map((item, index) => {
      const kind = getItemSpellKind(item);
      const ref = kind ? getItemSpellRef(item) : null;
      return ref ? { item, index, kind, ref } : null;
    })
    .filter(Boolean);
}

// What a row shows as its uses: a wand's use for the day, or how many
// scrolls are left
function getItemSpellRowUses(item, kind) {
  if (kind === "wand") {
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
function buildItemSpellRow(item, index, kind, spell) {
  return {
    _id: `itemspell-${item?._id || index}`,
    name: spell.name,
    portrait: spell.portrait,
    recordType: "spells",
    data: {
      type: "spell",
      ...(spell.data || {}),
      ...getItemSpellRowUses(item, kind),
      itemSpell: { itemId: item?._id || "", itemIndex: index, itemName: item?.name || "", kind, spellId: spell._id || "" },
    },
    fields: {
      spellDetails: { hidden: false },
      spellSlot: { hidden: true },
      nameBox: { hidden: false },
      nameUsedBox: { hidden: true },
      innateBox: { hidden: false },
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

// The Scrolls and Wands entry as the inventory has it, given each item's
// spell ({ [getItemSpellKey]: spell }): a row per scroll and wand at the
// item's rank, and the caster's numbers for the first one (every cast works
// them out again for its own spell). null when there are none.
function buildItemSpellsEntry(record, spellsByItem) {
  const listed = getInventoryItemSpells(record).filter(({ item, index }) => spellsByItem[getItemSpellKey(item, index)]);
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
  listed.forEach(({ item, index, kind }) => {
    const spell = spellsByItem[getItemSpellKey(item, index)];
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
  Object.assign(data, getItemSpellCasting(record, spellsByItem[getItemSpellKey(first.item, first.index)]).casting);
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
    items.forEach(({ item, index, ref }) => {
      const row = rows.find(
        (r) =>
          r?.data?.itemSpell?.itemId === (item._id || "") &&
          String(r?.name || "").trim().toLowerCase() === String(ref.name || "").trim().toLowerCase(),
      );
      if (row) spellsByItem[getItemSpellKey(item, index)] = getItemSpellFromRow(row);
      else missing.push({ item, index, ref });
    });
    if (missing.length === 0) return writeItemSpells(current, spellsByItem, done);
    let pending = missing.length;
    missing.forEach(({ item, index, ref }) =>
      findItemSpell(ref, (spell) => {
        if (spell) spellsByItem[getItemSpellKey(item, index)] = spell;
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
function getItemSpellUseValues(item, itemPath, kind) {
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
      ...getItemSpellUseValues(found.item, `data.inventory.${found.index}`, found.kind),
      itemIndex: found.index,
      itemId: found.item._id || "",
    };
    Object.assign(values, use.values);
    values[`${rowPath}.data.uses`] = use.left;
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
  const recalc = (updated) => updateTotalBulk(updated || record, true);
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
