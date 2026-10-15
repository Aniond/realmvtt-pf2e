// Spellcasting entries made from the character's class: the Spells per Day
// tables, the class specs, building and syncing the entries the sheet
// manages, and the helpers they share with spells.js. Loaded as one of the
// ruleset's scripts (ruleset.config.json, otherSettings.scripts), so it
// shares the global scope with common.js at runtime.

// The character's own rank for an entry's statistic: spell attacks and DCs,
// or the class DC
function getCharacterSpellcastingRank(record, proficiency, valuesToSet = {}) {
  const rank =
    (proficiency || "spell") === "spell"
      ? valuesToSet["data.spellcasting"] ?? record.data?.spellcasting
      : valuesToSet["data.classDCProficiency"] ??
        record.data?.classDCProficiency;
  return parseInt(rank || "0", 10) || 0;
}

// Proficiency rank for an entry's spell attacks and DCs: the higher of the
// character's rank and the entry's own. A managed entry's own rank is the one
// picked in its training dropdown (or the one it had above the character's
// when it was taken over), and its source's (auto.training, 0 for the class).
// It isn't read back from data.training, so the entry follows the character's
// rank down as well as up and the sync never undoes itself.
function getSpellcastingEntryTraining(
  record,
  spellcastingEntry,
  valuesToSet = {},
) {
  const rank = getCharacterSpellcastingRank(
    record,
    spellcastingEntry.data?.proficiency,
    valuesToSet,
  );
  const toRank = (value) => parseInt(value || "0", 10) || 0;

  if (isManagedSpellcastingEntry(spellcastingEntry)) {
    const auto = spellcastingEntry.data.auto;
    return Math.max(rank, toRank(auto.training), toRank(auto.ownTraining));
  }
  return Math.max(rank, toRank(spellcastingEntry.data?.training));
}

// Writes the spellcasting entries. Adding or removing an entry or a spell row
// writes the whole list (never the list and its fields in one payload);
// otherwise only the fields that changed are written, so a run that changes
// nothing (onTurnStart) writes nothing and can't undo a cast made meanwhile.
function setSpellcastingEntryValues(record, entries, valuesToSet) {
  const oldEntries = record.data?.spells || [];
  const rowsChanged = (entry, oldEntry) =>
    SPELL_RANK_LISTS.some(
      (list) =>
        JSON.stringify(entry.data?.[list]) !==
        JSON.stringify(oldEntry?.data?.[list]),
    );
  const structural =
    entries.length !== oldEntries.length ||
    entries.some(
      (entry, index) =>
        entry._id !== oldEntries[index]?._id ||
        rowsChanged(entry, oldEntries[index]),
    );

  if (structural) {
    valuesToSet["data.spells"] = entries;
    return;
  }
  entries.forEach((entry, index) => {
    setChangedValues(oldEntries[index], entry, `data.spells.${index}`, valuesToSet);
  });
}

// Copies record data (plain JSON) so it can be changed before writing
function cloneRecordData(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Adds every field that differs between two versions of an object to
// valuesToSet. Lists, and objects that are new, are written whole.
function setChangedValues(before, after, path, valuesToSet) {
  const isObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject(before) && isObject(after)) {
    for (const key of Object.keys(after)) {
      setChangedValues(before[key], after[key], `${path}.${key}`, valuesToSet);
    }
  } else if (JSON.stringify(before) !== JSON.stringify(after)) {
    valuesToSet[path] = after;
  }
}

// ---------------------------------------------------------------------------
// Spellcasting entries from the class
//
// Each caster class gets its spellcasting entries automatically, sized from
// the class's Spells per Day table at the character's level. The entries the
// sheet manages carry data.auto:
//   source     "class:wizard", "class:cleric:font", "class:animist:apparition"
//   version    SPELLCASTING_SYNC_VERSION when last synced
//   base       the table counts last written (numCantrips, numSpells1-10, and
//              repCantrips, rep1-10 for repertoire rows). A count above or
//              below its base is the player's own change, kept on top of the
//              table at later levels.
//   offCounts  the counts when "Set slots from level" was turned off, to tell
//              the ones the player changed meanwhile when it's turned back on
//   type, tradition, attribute   the values last written; once the player
//              picks something else, theirs is kept
//   training   the source's own rank (0 for class entries)
//   ownTraining  the rank picked in the entry's training dropdown, or the
//              rank it had over the character's when it was taken over (or,
//              for a Divine Font or apparition entry the sheet made, the
//              class's entry's then)
//   shown      the spell lists the sheet last showed
//   adopted    the player made the entry and the sheet took it over
//   raisedFrom the counts the takeover raised to the class's, as they were
//              (the takeover notice names them)
//   fontSlotsMoved  Divine Font slots that were moved out of it on takeover
//   spellFilter  the Divine Font's spell (heal or harm). Not read yet: the
//              spell picker (phase C) will offer only these.
//   orphaned   the source is gone; the entry is kept but no longer managed
// data.autoSlots (the "Set slots from level" checkbox) turns the counts and
// rows off for one entry. Deleting a managed entry adds its source to
// data.spellcastingDismissed so it isn't created again.
// ---------------------------------------------------------------------------

// Raised when the sync changes, so characters on older versions are synced
// once when their sheet opens
const SPELLCASTING_SYNC_VERSION = 1;

// An entry's spell lists, indexed by rank
const SPELL_RANK_LISTS = [
  "cantrips",
  "spells1",
  "spells2",
  "spells3",
  "spells4",
  "spells5",
  "spells6",
  "spells7",
  "spells8",
  "spells9",
  "spells10",
];

// Animist apparition slots (War of Immortals pg. 10), by rank and level
const APPARITION_SPELL_SLOTS = {
  1: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  2: [0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  3: [0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  4: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  5: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2],
  6: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
  7: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
  8: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2],
  9: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
  // Supreme Incarnation
  10: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
};

// Attuned apparitions by level (Third Apparition at 7th, Fourth at 15th)
const ATTUNED_APPARITIONS = [
  2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4,
];

// Spell slots of a rank at a level for a Spells per Day table (Archives of
// Nethys class tables). A new rank r arrives at level 2r - 1.
//   FULL3      2 slots of a new rank, then 3 (bard, cleric, druid, witch,
//              wizard, Advanced Player's Guide oracle)
//   FULL4      3, then 4 (sorcerer, Player Core 2 oracle)
//   TWO        1, then 2 (psychic, necromancer)
//   TWO_NO10   as TWO with no 10th rank (animist, Impossible Magic magus and
//              summoner)
//   BOUNDED    only the two highest ranks, 2 slots each (Secrets of Magic
//              magus and summoner)
//   FLEXIBLE   2 of each rank (Flexible Spellcaster class archetype)
//   APPARITION the animist's apparition slots
// The 10th-rank slot comes at 19th level.
function getSpellSlotCount(table, rank, level) {
  level = Math.min(20, parseInt(level, 10) || 0);
  if (!(rank >= 1 && rank <= 10) || level < 1) {
    return 0;
  }
  if (table === "APPARITION") {
    return APPARITION_SPELL_SLOTS[rank]?.[level - 1] || 0;
  }
  if (rank === 10) {
    return ["FULL3", "FULL4", "TWO", "FLEXIBLE"].includes(table) && level >= 19
      ? 1
      : 0;
  }
  if (table === "BOUNDED") {
    if (level <= 4) {
      return ({ 1: [1, 2, 2, 2], 2: [0, 0, 1, 2] }[rank] || [])[level - 1] || 0;
    }
    const top = Math.min(9, Math.ceil(level / 2));
    return rank === top || rank === top - 1 ? 2 : 0;
  }
  const counts = {
    FULL3: [2, 3],
    FULL4: [3, 4],
    TWO: [1, 2],
    TWO_NO10: [1, 2],
    FLEXIBLE: [2, 2],
  }[table];
  const firstLevel = 2 * rank - 1;
  if (!counts || level < firstLevel) {
    return 0;
  }
  return level === firstLevel ? counts[0] : counts[1];
}

// Spellcasting of each caster class, keyed by the slug of the class name.
// `legacy` holds what the pre-remaster book does differently. A tradition
// given as { flag } comes from the class choice stored in that flag.
const CLASS_SPELLCASTING = {
  // The muse adds a 1st-rank spell to the repertoire
  bard: {
    type: "spontaneous",
    tradition: "Occult",
    attribute: "cha",
    cantrips: 5,
    table: "FULL3",
    repertoireExtra: { 1: 1 },
  },
  // Divine Font: 4 extra slots at the highest rank, 5 from 5th level, 6 from
  // 15th; 1 + Charisma modifier in the Core Rulebook
  cleric: {
    type: "prepared",
    tradition: "Divine",
    attribute: "wis",
    cantrips: 5,
    table: "FULL3",
    font: [4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6],
    legacy: { font: "1+cha" },
  },
  druid: {
    type: "prepared",
    tradition: "Primal",
    attribute: "wis",
    cantrips: 5,
    table: "FULL3",
  },
  witch: {
    type: "prepared",
    tradition: { flag: "patron" },
    attribute: "int",
    cantrips: 5,
    table: "FULL3",
  },
  // An arcane school adds a cantrip and a slot at each rank 1-9 (curriculum
  // or school spells); Unified Magical Theory and the Core Rulebook's
  // Universalist don't. The Realm data has no Core Rulebook wizard yet, so
  // the Universalist matches whatever its option is named ("Universalist",
  // "Universalist Wizard").
  wizard: {
    type: "prepared",
    tradition: "Arcane",
    attribute: "int",
    cantrips: 5,
    table: "FULL3",
    schoolSlot: {
      flag: "arcaneSchool",
      none: /unified-magical-theory|universalist/,
    },
  },
  // Draconic's tradition comes from the dragon chosen with it
  sorcerer: {
    type: "spontaneous",
    tradition: { flag: "bloodline", nested: "dragonBloodline" },
    attribute: "cha",
    cantrips: 5,
    table: "FULL4",
  },
  // The Advanced Player's Guide oracle had 2/3 slots and its mystery's
  // granted cantrip on top of 5
  oracle: {
    type: "spontaneous",
    tradition: "Divine",
    attribute: "cha",
    cantrips: 5,
    table: "FULL4",
    legacy: { table: "FULL3", cantrips: 6 },
  },
  // Secrets of Magic: bounded casting, plus 2 studious spell slots of 2nd
  // rank at 7th level, 3rd at 11th and 4th at 13th
  magus: {
    type: "prepared",
    tradition: "Arcane",
    attribute: "int",
    cantrips: 5,
    table: "TWO_NO10",
    legacy: {
      table: "BOUNDED",
      studious: [0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4],
    },
  },
  // Secrets of Magic: bounded casting. The repertoire starts with two 1st-rank
  // spells and reaches its maximum of 5 at 4th level, which it keeps as low
  // ranks are lost; the spell over the slot count sits at the lowest rank.
  summoner: {
    type: "spontaneous",
    tradition: { flag: "eidolon" },
    attribute: "cha",
    cantrips: 5,
    table: "TWO_NO10",
    legacy: { table: "BOUNDED", repertoireExtraLowest: 1 },
  },
  // Intelligence or Charisma by subconscious mind (the key attribute). The
  // conscious mind adds a spell of each rank to the repertoire, and psi
  // cantrips on top of the 3: 2 standard and the surface one, the deeper one
  // at 6th level and the deepest at 10th.
  psychic: {
    type: "spontaneous",
    tradition: "Occult",
    attribute: "key",
    cantrips: 3,
    table: "TWO",
    repertoireExtraPerRank: 1,
    psiCantrips: [3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  },
  // Apparition spellcasting is a second, spontaneous entry. Each attuned
  // apparition adds a cantrip and a spell of each rank to its repertoire.
  animist: {
    type: "prepared",
    tradition: "Divine",
    attribute: "wis",
    cantrips: 2,
    table: "TWO_NO10",
    extraEntries: [
      {
        suffix: "apparition",
        name: "Apparition Spells",
        type: "spontaneous",
        cantrips: ATTUNED_APPARITIONS,
        table: "APPARITION",
        attunedRepertoire: true,
      },
    ],
  },
  necromancer: {
    type: "prepared",
    tradition: "Occult",
    attribute: "int",
    cantrips: 5,
    table: "TWO",
  },
};

// Flexible Spellcaster class archetype (Secrets of Magic pg. 209), from the
// class feature Flexible Spell Preparation or its dedication: 2 slots of each
// rank and 2 fewer class cantrips, back to 4 with the dedication at 2nd level
// and 5 from 4th. Only for classes that prepare the standard 2-then-3 slots;
// restricted extra slots (school spells, Divine Font) don't change.
const FLEXIBLE_CANTRIPS = [
  3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
];

function hasFlexibleSpellcasting(record) {
  return (
    hasFeatNamed(record, "Flexible Spell Preparation") ||
    hasFeatNamed(record, "Flexible Spellcaster Dedication")
  );
}

// Draconic bloodline (Player Core 2 pg. 150): the tradition of the chosen
// dragon, as Archives of Nethys gives it from the dragon's Monster Core,
// Monster Core 2 or Draconic Codex entry (Foundry's dragonBloodline choice
// maps most of these to arcane instead). The chromatic and metallic dragons
// were never remastered and stay arcane, as in the Core Rulebook; a dragon not
// listed here also defaults to arcane, and the player can change it on the
// entry.
const DRAGON_TRADITIONS = {
  "arcane-dragon": "Arcane",
  "divine-dragon": "Divine",
  "occult-dragon": "Occult",
  "primal-dragon": "Primal",
  // Monster Core and Monster Core 2
  "adamantine-dragon": "Primal",
  "cinder-dragon": "Primal",
  "conspirator-dragon": "Occult",
  "coral-dragon": "Primal",
  "despair-dragon": "Occult",
  "diabolic-dragon": "Divine",
  "empyreal-dragon": "Divine",
  "fortune-dragon": "Arcane",
  "horned-dragon": "Primal",
  "mirage-dragon": "Arcane",
  "omen-dragon": "Occult",
  "phase-dragon": "Arcane",
  "requiem-dragon": "Divine",
  "resurrection-dragon": "Divine",
  "rune-dragon": "Arcane",
  "whisper-dragon": "Occult",
  // Draconic Codex, including the remastered imperial and primal dragons
  "barrage-dragon": "Arcane",
  "bog-dragon": "Primal",
  "brine-dragon": "Primal",
  "cloud-dragon": "Primal",
  "crystal-dragon": "Primal",
  "delight-dragon": "Divine",
  "executor-dragon": "Divine",
  "forest-dragon": "Primal",
  "magma-dragon": "Primal",
  "mocking-dragon": "Occult",
  "oath-dragon": "Divine",
  "rime-dragon": "Primal",
  "sage-dragon": "Occult",
  "sea-dragon": "Arcane",
  "sky-dragon": "Divine",
  "sovereign-dragon": "Occult",
  "stormcrown-dragon": "Primal",
  "time-dragon": "Arcane",
  "umbral-dragon": "Occult",
  "underworld-dragon": "Arcane",
  "vizier-dragon": "Occult",
  "vorpal-dragon": "Arcane",
  "wailing-dragon": "Arcane",
  "wish-dragon": "Arcane",
};

// Traditions of bloodlines, patrons and eidolons by name, for when the chosen
// feature isn't on the character or doesn't say. Draconic and the remaster
// dragon eidolon have no fixed tradition. A tradition given as { legacy }
// holds for that edition of the class only.
const SUBCLASS_TRADITIONS = {
  bloodline: {
    aberrant: "Occult",
    aesir: "Divine",
    angelic: "Divine",
    demonic: "Divine",
    diabolic: "Divine",
    elemental: "Primal",
    fey: "Primal",
    genie: "Arcane",
    hag: "Occult",
    harrow: "Occult",
    imperial: "Arcane",
    nymph: "Primal",
    phoenix: "Primal",
    psychopomp: "Divine",
    shadow: "Occult",
    undead: "Divine",
    wyrmblessed: "Divine",
  },
  patron: {
    "baba-yaga": "Occult",
    "choir-politic": "Divine",
    cobyslarni: "Occult",
    curse: "Occult",
    "devourer-of-decay": "Primal",
    "faiths-flamekeeper": "Divine",
    fate: "Occult",
    fervor: "Divine",
    "mosquito-witch": "Primal",
    night: "Occult",
    pacts: "Occult",
    "paradox-of-opposites": "Divine",
    "ripple-in-the-deep": "Primal",
    rune: "Arcane",
    "silence-in-snow": "Primal",
    "spinner-of-threads": "Occult",
    "starless-shadow": "Occult",
    "the-inscribed-one": "Arcane",
    "the-resentment": "Occult",
    "the-unseen-broker": "Occult",
    "whisper-of-wings": "Primal",
    wild: "Primal",
    "wilding-steward": "Primal",
    winter: "Primal",
  },
  eidolon: {
    aberrant: "Occult",
    angel: "Divine",
    "anger-phantom": "Occult",
    beast: "Primal",
    construct: "Arcane",
    demon: "Divine",
    "devotion-phantom": "Occult",
    // Secrets of Magic; the remaster's takes its dragon's tradition
    dragon: { legacy: "Arcane" },
    elemental: "Primal",
    fey: "Primal",
    ooze: "Arcane",
    plant: "Primal",
    psychopomp: "Divine",
    swarm: "Primal",
    undead: "Divine",
  },
};

const SPELL_TRADITIONS = ["Arcane", "Divine", "Occult", "Primal"];

// Which book a class or feat follows: legacy (Core Rulebook era) or remaster.
// Without a remaster flag, the book's title decides.
function getSpellcastingEdition(source) {
  const publication = source?.data?.publication;
  if (publication?.remaster === false) return "legacy";
  if (publication?.remaster === true) return "remaster";
  return /Secrets of Magic|Core Rulebook|Advanced Player|Dark Archive$/i.test(
    publication?.title || "",
  )
    ? "legacy"
    : "remaster";
}

// The class's spellcasting for its edition, or null for classes without
// spell slots
function getClassSpellcasting(classObj) {
  const name = `${classObj?.name || ""}`.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const slug = toSlug(name);
  if (!Object.prototype.hasOwnProperty.call(CLASS_SPELLCASTING, slug)) {
    return null;
  }
  const casting = CLASS_SPELLCASTING[slug];
  const edition = getSpellcastingEdition(classObj);
  return { ...casting, ...(casting[edition] || {}), slug, name, edition };
}

// The class feature (or feat) chosen for a choice whose flag holds `slug`
function findChosenFeature(record, slug) {
  const classFeatures = (record.data?.classes || []).flatMap(
    (classObj) => classObj?.data?.features || [],
  );
  return (
    [
      ...classFeatures,
      ...(record.data?.feats || []),
      ...(record.data?.bonusFeats || []),
    ].find(
      (feature) => feature?.data?.type !== "slot" && toSlug(feature?.name) === slug,
    ) || null
  );
}

// A bloodline, patron or eidolon's tradition, from its roll option
// (feature:bloodline:tradition:occult) or its "Tradition" / "Spell List"
// line. "variable" when it depends on another choice.
function getFeatureTradition(feature) {
  for (const modifier of feature?.data?.modifiers || []) {
    const match = `${modifier.data?.option || ""}`.match(
      /^feature:bloodline:tradition:(arcane|divine|occult|primal)$/i,
    );
    if (modifier.data?.type === "rollOption" && match) {
      return capitalize(match[1].toLowerCase());
    }
  }
  const match = `${feature?.data?.description || ""}`.match(
    /<strong>\s*(?:Tradition|Spell List)\s*<\/strong>\s*(arcane|divine|occult|primal|variable)/i,
  );
  return match ? capitalize(match[1].toLowerCase()) : null;
}

// The tradition set by a class choice (bloodline, patron, eidolon), or null
// while it is unmade or unknown. `edition` is the class's.
function getSubclassTradition(record, flag, nestedFlag, edition = "remaster") {
  const flags = record.data?.flags || {};
  const value = flags[flag];
  if (!value) {
    return null;
  }
  const chosen = findChosenFeature(record, value);
  const lookUp = (table, key) =>
    table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
  let tradition = chosen ? getFeatureTradition(chosen) : null;
  if (!tradition) {
    const name = `${value}`
      .replace(/^bloodline-/, "")
      .replace(/-(bloodline|eidolon|patron)$/, "");
    tradition = lookUp(SUBCLASS_TRADITIONS[flag], name);
    if (tradition && typeof tradition === "object") {
      tradition = tradition[edition] || null;
    }
  }
  if ((!tradition || tradition === "Variable") && nestedFlag && flags[nestedFlag]) {
    tradition = lookUp(DRAGON_TRADITIONS, flags[nestedFlag]) || "Arcane";
  }
  return SPELL_TRADITIONS.includes(tradition) ? tradition : null;
}

// A psychic casts with Intelligence or Charisma, the attribute their
// subconscious mind names (also their key attribute). Without a mind, the key
// attribute; the higher of the two until either is chosen.
function getKeySpellcastingAttribute(record, valuesToSet = {}) {
  const key = record.data?.keyAbility;
  const mindFlag = record.data?.flags?.subconsciousMind;
  const mind = mindFlag ? findChosenFeature(record, mindFlag) : null;
  const mindOptions = (mind?.data?.keyOptions || []).filter(
    (ability) => ability === "int" || ability === "cha",
  );
  if (mindOptions.length > 0) {
    return mindOptions.includes(key) ? key : mindOptions[0];
  }
  if (key === "int" || key === "cha") {
    return key;
  }
  const int = parseInt(valuesToSet["data.int"] ?? record.data?.int ?? 0, 10) || 0;
  const cha = parseInt(valuesToSet["data.cha"] ?? record.data?.cha ?? 0, 10) || 0;
  return cha > int ? "cha" : "int";
}

// Counts for one class entry at a level: numCantrips (prepared) and
// numSpells1-10, plus repertoire rows (repCantrips, rep1-10) for spontaneous
// casters
function getClassSpellcastingSpec(record, config, level, spec) {
  const cantrips = Array.isArray(config.cantrips)
    ? config.cantrips[level - 1]
    : config.cantrips || 0;
  const slots = {};
  for (let rank = 1; rank <= 10; rank++) {
    slots[rank] = getSpellSlotCount(config.table, rank, level);
  }

  // Bonus slots added to the entry: a wizard's school slots, and a legacy
  // magus's studious spell slots (`bonus` says which)
  let numCantrips = cantrips;
  let bonus = null;
  const school = config.schoolSlot && record.data?.flags?.[config.schoolSlot.flag];
  if (school && !config.schoolSlot.none.test(school)) {
    bonus = "school";
    numCantrips += 1;
    for (let rank = 1; rank <= 9; rank++) {
      if (slots[rank] > 0) {
        slots[rank] += 1;
      }
    }
  }
  const studiousRank = config.studious?.[level - 1];
  if (studiousRank) {
    bonus = "studious";
    slots[studiousRank] += 2;
  }

  const counts = {};
  if (config.type === "prepared") {
    counts.numCantrips = numCantrips;
  }
  for (let rank = 1; rank <= 10; rank++) {
    counts[`numSpells${rank}`] = slots[rank];
  }

  // A spontaneous caster learns a spell for each slot. The 10th-rank class
  // feature adds 2 spells for its 1 slot.
  let repertoire = null;
  if (config.type === "spontaneous") {
    const lowestRank = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((rank) => slots[rank] > 0);
    repertoire = {
      repCantrips: numCantrips + (config.psiCantrips?.[level - 1] || 0),
    };
    for (let rank = 1; rank <= 10; rank++) {
      let known = 0;
      if (slots[rank] > 0 && config.attunedRepertoire) {
        known = rank === 10 ? slots[rank] : cantrips;
      } else if (slots[rank] > 0 && rank === 10) {
        known = 2;
      } else if (slots[rank] > 0) {
        known =
          slots[rank] +
          (config.repertoireExtra?.[rank] || 0) +
          (config.repertoireExtraPerRank || 0) +
          (rank === lowestRank ? config.repertoireExtraLowest || 0 : 0);
      }
      repertoire[`rep${rank}`] = known;
    }
  }

  return { ...spec, type: config.type, counts, repertoire, training: 0, bonus };
}

// Divine Font: its own prepared entry, as its slots only take heal or harm.
// They sit at the highest rank of cleric slots, staying at 9th once the
// 10th-rank slot arrives (10th-rank slots can't be used with abilities that
// give more slots).
function getDivineFontSpec(record, casting, level, valuesToSet) {
  let highestRank = 0;
  for (let rank = 1; rank <= 10; rank++) {
    if (getSpellSlotCount(casting.table, rank, level) > 0) {
      highestRank = rank;
    }
  }
  const fontRank = Math.min(9, highestRank);
  const cha = parseInt(valuesToSet["data.cha"] ?? record.data?.cha ?? 0, 10) || 0;
  const count = Array.isArray(casting.font)
    ? casting.font[level - 1]
    : Math.max(0, 1 + cha);

  const counts = { numCantrips: 0 };
  for (let rank = 1; rank <= 10; rank++) {
    counts[`numSpells${rank}`] = rank === fontRank ? count : 0;
  }
  const font = `${record.data?.flags?.divineFont || ""}`;
  return {
    source: `class:${casting.slug}:font`,
    name: "Divine Font",
    type: "prepared",
    tradition: typeof casting.tradition === "string" ? casting.tradition : null,
    attribute: casting.attribute,
    counts,
    repertoire: null,
    training: 0,
    fontRank,
    spellFilter: font.includes("harm") ? ["harm"] : font.includes("heal") ? ["heal"] : null,
  };
}

// The spellcasting entries a character's class gives at a level, as specs:
// { source, name, level, type, tradition (null while the choice that sets it
// is unmade), attribute, counts, repertoire, training, bonus ("school" or
// "studious" when the counts hold those bonus slots), and fontRank and
// spellFilter for the Divine Font }. Empty for NPCs, level 0 characters and
// classes without spell slots.
function getWantedSpellcastingEntries(record, level, valuesToSet = {}) {
  level = Math.min(20, parseInt(level, 10) || 0);
  if (record?.recordType !== "characters" || isLevelZeroCharacter(record) || level < 1) {
    return [];
  }
  let casting = getClassSpellcasting(record.data?.classes?.[0]);
  if (!casting) {
    return [];
  }
  if (
    casting.type === "prepared" &&
    casting.table === "FULL3" &&
    hasFlexibleSpellcasting(record)
  ) {
    casting = { ...casting, table: "FLEXIBLE", cantrips: FLEXIBLE_CANTRIPS };
  }

  const tradition =
    typeof casting.tradition === "string"
      ? casting.tradition
      : getSubclassTradition(
          record,
          casting.tradition.flag,
          casting.tradition.nested,
          casting.edition,
        );
  const attribute =
    casting.attribute === "key"
      ? getKeySpellcastingAttribute(record, valuesToSet)
      : casting.attribute;

  const specs = [
    getClassSpellcastingSpec(record, casting, level, {
      source: `class:${casting.slug}`,
      name: `${casting.name} Spells`,
      tradition,
      attribute,
    }),
  ];
  for (const extra of casting.extraEntries || []) {
    specs.push(
      getClassSpellcastingSpec(record, extra, level, {
        source: `class:${casting.slug}:${extra.suffix}`,
        name: extra.name,
        tradition,
        attribute,
      }),
    );
  }
  if (casting.font) {
    specs.push(getDivineFontSpec(record, casting, level, valuesToSet));
  }
  return specs.map((spec) => ({ ...spec, level }));
}

function isManagedSpellcastingEntry(spellcastingEntry) {
  const auto = spellcastingEntry?.data?.auto;
  return !!auto?.source && !auto.orphaned;
}

// Which settings and buttons an entry shows for its type
function getSpellcastingEntryTypeFields(type) {
  const isFocus = type === "focus";
  const isSpontaneous = type === "spontaneous";
  const isInnate = type === "innate" || type === "item";
  const isPrepared = !isInnate && !isFocus && !isSpontaneous;
  const fields = {
    preparedBox: { hidden: !isPrepared },
    spontaneousBox: { hidden: !isSpontaneous },
    addBtn: { hidden: !isSpontaneous && !isFocus && !isInnate },
    focusPoolLabel: { hidden: !isFocus },
    focusPool: { hidden: !isFocus },
    focusPoolMax: { hidden: !isFocus },
    numCantrips: { hidden: isSpontaneous || isFocus || isInnate },
    numCantripSpontaneousLabel: {
      hidden: !isSpontaneous && !isInnate && !isFocus,
    },
  };
  for (let rank = 1; rank <= 10; rank++) {
    fields[`numSpells${rank}`] = { hidden: isInnate || isFocus };
  }
  return fields;
}

// A new spellcasting entry, from the Add Spellcasting Entry popover or made
// from the class
function buildSpellcastingEntry({
  name = "",
  type = "prepared",
  proficiency = "spell",
  tradition = "Arcane",
  attribute = "int",
  training = 0,
  dc = 0,
  mod = 0,
  shownSpells = ["cantrips", "spells1"],
  isFirst = false,
} = {}) {
  const isItem = type === "item";
  const fields = {
    ...getSpellcastingEntryTypeFields(type),
    // Item type casting will always be manually setting DC/Mod
    training: { hidden: isItem },
    tradition: { hidden: isItem },
    moveUpBtn: { hidden: isFirst },
  };
  for (const list of shownSpells) {
    fields[`${list}Box`] = { hidden: false };
  }
  return {
    _id: generateUuid(),
    name: name || `${tradition} ${capitalize(type)} Spells`,
    unidentifiedName: "Spellcasting Entry",
    identified: true,
    data: {
      type,
      proficiency,
      tradition,
      attribute,
      training,
      dc,
      mod,
      shownSpells: [...shownSpells],
      focusPoolMax: 1,
    },
    fields,
  };
}

// An empty row in a spell list: a prepared slot ("Rank 2 Spell Slot"), or a
// spontaneous caster's repertoire placeholder ("New Rank 2 Spell"), which can
// be deleted
function buildSpellRow(kind, rank, order) {
  const isCantrip = rank === 0;
  const isPrepared = kind === "prepared";
  let name = isCantrip ? "Cantrip Slot" : `Rank ${rank} Spell Slot`;
  if (!isPrepared) {
    name = isCantrip ? "New Cantrip" : `New Rank ${rank} Spell`;
  }
  return {
    _id: generateUuid(),
    name,
    recordType: "spells",
    unidentifiedName: name,
    data: {
      type: "slot",
      description: "",
      level: rank,
      slotOrder: order,
    },
    fields: {
      spellDetails: { hidden: true },
      innateBox: { hidden: true },
      spellSlot: { hidden: false },
      used: { hidden: !isPrepared || isCantrip },
      deleteBtn: { hidden: isPrepared },
    },
  };
}

const isFilledSpellRow = (row) => row?.data?.type !== "slot";

// Adds empty rows to reach wantRows, or removes empty rows from the end.
// Chosen spells are never removed. Returns the same list when nothing changed.
function resizeSpellRows(rows, wantRows, kind, rank) {
  const resized = [...rows];
  for (let i = resized.length - 1; i >= 0 && resized.length > wantRows; i--) {
    if (!isFilledSpellRow(resized[i])) {
      resized.splice(i, 1);
    }
  }
  while (resized.length < wantRows) {
    resized.push(buildSpellRow(kind, rank, resized.length));
  }
  if (resized.length === rows.length && resized.every((row, i) => row === rows[i])) {
    return rows;
  }
  resized.forEach((row, index) => {
    row.data = { ...row.data, slotOrder: index };
  });
  return resized;
}

// The class a spec comes from ("wizard" for class:wizard:...) and the words
// that name an entry as the spec's own: the class, and the spec's name
// without "Spells" ("apparition", "divine font")
function getSpellcastingSpecNames(spec) {
  const classSlug = `${spec.source || ""}`.split(":")[1] || "";
  const names = [
    classSlug.replace(/-/g, " "),
    `${spec.name || ""}`.replace(/ Spells$/, "").toLowerCase(),
  ].filter(Boolean);
  return { classSlug, names };
}

function isNamedForSpellcastingSpec(entry, spec) {
  const name = `${entry?.name || ""}`.toLowerCase();
  return getSpellcastingSpecNames(spec).names.some((own) => name.includes(own));
}

// Whether a name holds a word on its own ("Bard Spells", "Bard's Spells"),
// not inside another ("Bardolph's Grimoire")
function nameHasWord(name, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}(?:s|'s|’s)?\\b`, "i").test(`${name || ""}`);
}

// The most cantrips archetype spellcasting gives: 2 from a dedication and 2
// from Cantrip Expansion
const ARCHETYPE_MAX_CANTRIPS = 4;

// What an entry holds at a count ("numCantrips", "numSpells3"): the count,
// or the spells filled in at that rank if there are more, as on older
// characters whose counts were never set
function getHeldSpellCount(entry, key) {
  const count = parseInt(entry?.data?.[key] || 0, 10) || 0;
  const list = key === "numCantrips" ? "cantrips" : key.replace(/^numSpells/, "spells");
  return Math.max(count, (entry?.data?.[list] || []).filter(isFilledSpellRow).length);
}

// The highest rank an entry holds a slot or a spell at, or 0
function getTopHeldSpellRank(entry) {
  let top = 0;
  for (let rank = 1; rank <= 10; rank++) {
    if (getHeldSpellCount(entry, `numSpells${rank}`) > 0) {
      top = rank;
    }
  }
  return top;
}

// Whether an entry holds under half the spell slots the class has at this
// level, from 2nd level (the earliest dedication): an archetype gives a few.
// Cantrips don't count, as a class's entry may keep them in another entry,
// but one with the class's whole set of them, more than archetype
// spellcasting gives, is the class's however far behind its slots are. Each
// count is at least the spells filled in at it.
// Null for an entry with no counts or spells yet, which can't be told.
function hasFewSpellcastingSlots(entry, spec) {
  const heldOf = (key) => getHeldSpellCount(entry, key);
  const keys = Object.keys(spec.counts || {});
  const hasRows = SPELL_RANK_LISTS.some((list) => (entry.data?.[list] || []).length > 0);
  if (keys.every((key) => heldOf(key) === 0) && !hasRows) {
    return null;
  }
  const cantrips = heldOf("numCantrips");
  if (cantrips > ARCHETYPE_MAX_CANTRIPS && cantrips >= (spec.counts?.numCantrips || 0)) {
    return false;
  }
  const slotKeys = keys.filter((key) => key !== "numCantrips");
  const total = (valueOf) => slotKeys.reduce((sum, key) => sum + valueOf(key), 0);
  return spec.level >= 2 && total(heldOf) * 2 < total((key) => spec.counts[key] || 0);
}

// Whether an entry has no cantrips and something prepared, all of it heal or
// harm: a Divine Font's entry, whatever its counts
function holdsOnlyFontSpells(entry) {
  const data = entry?.data || {};
  if ((parseInt(data.numCantrips || 0, 10) || 0) > 0 || (data.cantrips || []).length > 0) {
    return false;
  }
  const spells = SPELL_RANK_LISTS.flatMap((list) => (data[list] || []).filter(isFilledSpellRow));
  return spells.length > 0 && spells.every((row) => /^(heal|harm)$/i.test(`${row.name || ""}`.trim()));
}

// The highest rank of the slots archetype spellcasting feats give at a
// level: Basic Spellcasting's 1st to 3rd at 4th, 6th and 8th level, Expert
// Spellcasting's 4th to 6th at 12th, 14th and 16th, and Master
// Spellcasting's 7th and 8th at 18th and 20th
function getArchetypeSpellRank(level) {
  if (level >= 12) {
    return Math.min(8, Math.floor(level / 2) - 2);
  }
  return level >= 4 ? Math.min(3, Math.floor(level / 2) - 1) : 0;
}

// Whether an entry holds the slots archetype spellcasting feats give at a
// level: none above the rank they reach, 1 of each of its two highest ranks
// and up to 2 of the others (a Breadth feat adds 1 there), and the
// dedication's 2 cantrips at most. A class's own entry, even a level behind,
// has a higher rank or more slots, so this tells an archetype's entry apart
// where half the class's slots can't, next to a class with 1 or 2 slots a
// rank (psychic, summoner, animist).
function hasArchetypeSpellSlots(entry, level) {
  const countOf = (rank) => parseInt(entry.data?.[`numSpells${rank}`] || 0, 10) || 0;
  if ((parseInt(entry.data?.numCantrips || 0, 10) || 0) > 2) {
    return false;
  }
  let top = 0;
  for (let rank = 1; rank <= 10; rank++) {
    if (countOf(rank) > 0) {
      top = rank;
    }
  }
  if (top === 0 || top > getArchetypeSpellRank(level)) {
    return false;
  }
  for (let rank = 1; rank <= top; rank++) {
    if (countOf(rank) > (rank >= top - 1 ? 1 : 2)) {
      return false;
    }
  }
  return true;
}

// Whether an entry the player made is an archetype's rather than the class's:
// named for a dedication or an archetype, named for another caster class
// ("Bard Spells" on a sorcerer) while holding few of the class's slots, or
// holding the slots archetype feats give or few of the class's slots. A name
// like "The Witch's Grimoire" on an entry with the class's slots is the
// class's. An entry named for the class is the class's, as is one with a
// slot or spell above the ranks archetype feats give at this level (none
// before 4th), however far behind its counts are. One with no counts or
// spells yet can't be told.
function isArchetypeSpellcastingEntry(entry, spec) {
  const name = `${entry?.name || ""}`;
  if (/dedication|archetype/i.test(name)) {
    return true;
  }
  if (isNamedForSpellcastingSpec(entry, spec)) {
    return false;
  }
  if (getTopHeldSpellRank(entry) > getArchetypeSpellRank(spec.level)) {
    return false;
  }
  const { classSlug } = getSpellcastingSpecNames(spec);
  const otherClass = Object.keys(CLASS_SPELLCASTING).some(
    (slug) => slug !== classSlug && nameHasWord(name, slug.replace(/-/g, " ")),
  );
  return (
    (otherClass && hasFewSpellcastingSlots(entry, spec) !== false) ||
    hasArchetypeSpellSlots(entry, spec.level) ||
    hasFewSpellcastingSlots(entry, spec) === true
  );
}

// Whether an entry the player made holds the Divine Font. It has no cantrips
// (the font gives none, while a class's entry with the font's slots folded in
// has the class's: "Cleric Spells + Font"), isn't a dedication's or an
// archetype's, and has nothing but heal or harm prepared. It's named with the
// word "font" (of any type that holds spells, innate or spontaneous too), or,
// under another name, prepared with just the font's slots at this level: the
// sheet used to rename an entry to the Add Spellcasting Entry popover's name
// ("Divine Prepared Spells") whenever its counts changed, as the font's do at
// every odd level, so a font kept in its own entry is seldom named for it.
function isDivineFontSpellcastingEntry(entry, fontSpec) {
  const data = entry?.data || {};
  const type = data.type || "prepared";
  const name = `${entry?.name || ""}`;
  const countOf = (key) => parseInt(data[key] || 0, 10) || 0;
  if (type === "focus" || type === "item" || /dedication|archetype/i.test(name)) {
    return false;
  }
  if (countOf("numCantrips") > 0 || (data.cantrips || []).length > 0) {
    return false;
  }
  const spells = SPELL_RANK_LISTS.flatMap((list) => (data[list] || []).filter(isFilledSpellRow));
  if (!spells.every((row) => /^(heal|harm)$/i.test(`${row.name || ""}`.trim()))) {
    return false;
  }
  if (isDivineFontName(name)) {
    return true;
  }
  return (
    type === fontSpec.type &&
    Object.keys(fontSpec.counts).every((key) => countOf(key) === fontSpec.counts[key])
  );
}

// Whether a name has "font" as a word ("Divine Font", "Healing Font"), not
// inside another ("Fontaine's Scrolls")
function isDivineFontName(name) {
  return /\bfont\b/i.test(`${name || ""}`);
}

// Whether an entry the player made holds just the class's bonus slots, kept
// apart from the rest: a wizard's school cantrip and slots, 1 of a rank, or a
// legacy magus's 2 studious slots at one rank. Any ranks, as such an entry
// kept by hand may be a level or more behind.
function holdsBonusSpellSlots(entry, spec) {
  const data = entry?.data || {};
  if (
    !spec.bonus ||
    data.auto?.source ||
    (data.type || "prepared") !== spec.type ||
    /dedication|archetype/i.test(`${entry.name || ""}`)
  ) {
    return false;
  }
  const countOf = (key) => parseInt(data[key] || 0, 10) || 0;
  const slots = [];
  for (let rank = 1; rank <= 10; rank++) {
    if (countOf(`numSpells${rank}`) > 0) {
      slots.push(countOf(`numSpells${rank}`));
    }
  }
  return spec.bonus === "school"
    ? countOf("numCantrips") === 1 && slots.length > 0 && slots.every((count) => count === 1)
    : countOf("numCantrips") === 0 && slots.length === 1 && slots[0] === 2;
}

// The entries without data.auto a spec could take over, so existing
// characters don't get a second copy: those of the same type that aren't an
// archetype's. The Divine Font takes the entry that holds it, and the class
// leaves that entry to the font (`fontSpec`: the class's Divine Font, if it
// has one). An entry named for the class but holding few of its slots (a
// staff, scrolls) is a side entry while another holds the class's.
function getAdoptableSpellcastingEntries(entries, spec, fontSpec = null) {
  const candidates = entries.filter((entry) => {
    if (entry.data?.auto?.source) {
      return false;
    }
    if (spec.fontRank) {
      return isDivineFontSpellcastingEntry(entry, spec);
    }
    return (
      (entry.data?.type || "prepared") === spec.type &&
      !(fontSpec && isDivineFontSpellcastingEntry(entry, fontSpec)) &&
      !isArchetypeSpellcastingEntry(entry, spec)
    );
  });
  // A side entry: few of the class's slots, or, for a class with a Divine
  // Font, a font entry with out-of-date counts (a cleric's heal slots)
  const isSideEntry = (entry) =>
    hasFewSpellcastingSlots(entry, spec) === true || (!!fontSpec && holdsOnlyFontSpells(entry));
  if (
    !spec.fontRank &&
    candidates.some(
      (entry) => hasFewSpellcastingSlots(entry, spec) === false && !isSideEntry(entry),
    )
  ) {
    return candidates.filter((entry) => !isSideEntry(entry));
  }
  return candidates;
}

// An entry the player made for the class but set to the other way of casting
// (a sorcerer's entry left on the popover's "prepared"): named for the class
// or of its tradition, not an archetype's, and holding at least half the
// class's slots. While it's there the class's entry is neither taken over
// nor added, as either would double the slots, and the takeover notice says
// to set its type. It's looked for once every spec has taken its entry over,
// as an entry another spec takes (an animist's own spontaneous entry is its
// apparitions') isn't the class's.
function findMistypedClassEntry(entries, spec) {
  if (spec.fontRank || (spec.type !== "prepared" && spec.type !== "spontaneous")) {
    return null;
  }
  const otherType = spec.type === "prepared" ? "spontaneous" : "prepared";
  const tradition = `${spec.tradition || ""}`.toLowerCase();
  return (
    entries.find(
      (entry) =>
        !entry.data?.auto?.source &&
        (entry.data?.type || "prepared") === otherType &&
        (isNamedForSpellcastingSpec(entry, spec) ||
          (!!tradition && `${entry.data?.tradition || ""}`.toLowerCase() === tradition)) &&
        !isArchetypeSpellcastingEntry(entry, spec) &&
        hasFewSpellcastingSlots(entry, spec) === false,
    ) || null
  );
}

// The entry a spec takes over, as { entry, ambiguous }. Among the entries of
// the class's tradition, one named for the class wins, then the one whose
// counts are closest to the class table; the Add Spellcasting Entry popover's
// names ("Arcane Prepared Spells") count for nothing. With no entry of the
// tradition (the player kept the popover's "Arcane", or set none) or the
// tradition still unknown, the only entry of the type is taken, or the only
// one named for the class, and its tradition stays the player's. When entries
// tie, none is taken and `ambiguous` lists them.
function findAdoptableSpellcastingEntry(entries, spec, fontSpec = null) {
  const candidates = getAdoptableSpellcastingEntries(entries, spec, fontSpec);
  const tradition = `${spec.tradition || ""}`.toLowerCase();
  const sameTradition = tradition
    ? candidates.filter(
        (entry) => `${entry.data?.tradition || ""}`.toLowerCase() === tradition,
      )
    : [];
  const found = (entry) => ({ entry, ambiguous: [] });

  if (sameTradition.length > 0) {
    const tableDistance = (entry) =>
      Object.keys(spec.counts || {}).reduce(
        (total, key) =>
          total +
          Math.abs((parseInt(entry.data?.[key] || 0, 10) || 0) - (spec.counts[key] || 0)),
        0,
      );
    const ranked = sameTradition
      .map((entry) => ({
        entry,
        named: isNamedForSpellcastingSpec(entry, spec) ? 0 : 1,
        distance: tableDistance(entry),
      }))
      .sort((a, b) => a.named - b.named || a.distance - b.distance);
    const best = ranked.filter(
      ({ named, distance }) =>
        named === ranked[0].named && distance === ranked[0].distance,
    );
    return best.length === 1
      ? found(best[0].entry)
      : { entry: null, ambiguous: best.map(({ entry }) => entry) };
  }

  if (candidates.length === 1) {
    return found(candidates[0]);
  }
  const named = candidates.filter((entry) => isNamedForSpellcastingSpec(entry, spec));
  if (named.length === 1) {
    return found(named[0]);
  }
  return { entry: null, ambiguous: named.length > 1 ? named : candidates };
}

// Marks an entry the player made as taken over by the sheet, keeping a
// training rank they set above the character's as the entry's own
function adoptSpellcastingEntry(record, entry, valuesToSet) {
  entry.data = entry.data || {};
  const auto = (entry.data.auto = { ...(entry.data.auto || {}), adopted: true });
  const training = parseInt(entry.data.training || "0", 10) || 0;
  const characterRank = getCharacterSpellcastingRank(
    record,
    entry.data.proficiency,
    valuesToSet,
  );
  if (training > characterRank) {
    auto.ownTraining = training;
  }
}

// A class entry taken over that holds the Divine Font's slots on top of the
// class's (a 5th-level cleric's 3rd rank at 7: 2 + 5) gives them to the new
// Divine Font entry, with up to that many heal or harm spells prepared there.
// Any other count over the table is kept, and the takeover notice names it.
// Returns the spells moved.
function moveDivineFontSlots(entry, spec, fontSpec) {
  const key = `numSpells${fontSpec.fontRank}`;
  const fontCount = fontSpec.counts[key] || 0;
  const count = parseInt(entry.data[key] || 0, 10) || 0;
  if (fontCount === 0 || count - (spec.counts[key] || 0) !== fontCount) {
    return [];
  }
  entry.data[key] = count - fontCount;
  entry.data.auto.fontSlotsMoved = fontCount;

  const list = `spells${fontSpec.fontRank}`;
  const rows = entry.data[list] || [];
  const fontSpells = fontSpec.spellFilter || ["heal", "harm"];
  const fontSpell = new RegExp(`^(${fontSpells.join("|")})$`, "i");
  const moved = [];
  for (let i = rows.length - 1; i >= 0 && moved.length < fontCount; i--) {
    if (isFilledSpellRow(rows[i]) && fontSpell.test(`${rows[i].name || ""}`.trim())) {
      moved.unshift(rows[i]);
    }
  }
  if (moved.length > 0) {
    entry.data[list] = rows.filter((row) => !moved.includes(row));
  }
  return moved.map((row, index) => ({ ...row, data: { ...row.data, slotOrder: index } }));
}

// Brings one managed entry in line with its spec. The player's changes are
// kept: a count they raised or lowered stays that far from the table, and a
// tradition, attribute or type they picked stays theirs.
function applySpellcastingSpec(spellcastingEntry, spec) {
  const entry = spellcastingEntry;
  entry.data = entry.data || {};
  entry.fields = entry.fields || {};
  if (!entry._id) {
    entry._id = generateUuid();
  }
  const auto = (entry.data.auto = entry.data.auto || {});
  auto.source = spec.source;
  auto.version = SPELLCASTING_SYNC_VERSION;
  if (auto.orphaned) {
    auto.orphaned = false;
  }
  if (entry.data.autoSlots === undefined) {
    entry.data.autoSlots = true;
  }
  entry.fields.autoSlots = { hidden: false };

  // Settings follow the class until the player changes them
  for (const key of ["type", "tradition", "attribute"]) {
    if (!spec[key]) continue;
    if (!entry.data[key] || entry.data[key] === auto[key]) {
      entry.data[key] = spec[key];
    }
    auto[key] = spec[key];
  }
  auto.training = spec.training || 0;
  if (spec.fontRank) {
    // Not read yet: the spell picker (phase C) will offer only these
    auto.spellFilter = spec.spellFilter;
  }
  const type = entry.data.type || "prepared";
  Object.assign(entry.fields, getSpellcastingEntryTypeFields(type));

  const countOf = (key) => parseInt(entry.data[key] || 0, 10) || 0;
  // Repertoire targets count the rows of a list
  const rowsOf = (key) =>
    (entry.data[key === "repCantrips" ? "cantrips" : `spells${key.slice(3)}`] || [])
      .length;
  const valueOf = (key) => (key.startsWith("rep") ? rowsOf(key) : countOf(key));

  if (entry.data.autoSlots === false || (type !== "prepared" && type !== "spontaneous")) {
    // The counts stop following the table here. The last table counts stay,
    // and the counts as they are now are noted, so turning it back on can
    // tell the counts the player changed meanwhile from the ones they left.
    if (auto.base && !auto.offCounts) {
      auto.offCounts = {};
      for (const key of Object.keys(auto.base)) {
        auto.offCounts[key] = valueOf(key);
      }
    }
    return;
  }

  // Counts. A new or adopted entry (no base yet) never loses slots.
  const base = auto.base || {};
  const offCounts = auto.offCounts || null;
  // The table count a count's offset is measured from: the last one written,
  // or this level's for a count the player changed while "Set slots from
  // level" was off, which stays as they typed it
  const baseOf = (key, target) =>
    offCounts && offCounts[key] !== undefined && offCounts[key] !== valueOf(key)
      ? target
      : base[key];
  // A rank the table had slots in when the counts were last written and no
  // longer has (the level went down, even while "Set slots from level" was
  // off): what the player added or typed there doesn't carry down
  const rankGone = (key, target) => target === 0 && base[key] > 0 && !/Cantrips$/.test(key);
  const nextBase = {};
  const spellKeys = Object.keys(spec.counts).filter((key) => key !== "numCantrips");
  const sum = (getValue) => spellKeys.reduce((total, key) => total + getValue(key), 0);
  // The font's extra slots are one number that moves with its rank, so they
  // are measured over all ranks: from the last table counts, or from this
  // level's when the player changed the font's count while "Set slots from
  // level" was off (its rank may have moved meanwhile), so it stays as typed
  const fontTyped =
    !!offCounts && sum((key) => offCounts[key] ?? countOf(key)) !== sum(countOf);
  const fontExtra = !spec.fontRank
    ? 0
    : auto.base
      ? sum(countOf) - sum((key) => (fontTyped ? spec.counts[key] : base[key]) || 0)
      : Math.max(0, sum(countOf) - sum((key) => spec.counts[key]));
  const before = {};
  for (const key of Object.keys(spec.counts)) {
    const target = spec.counts[key] || 0;
    const current = countOf(key);
    const last = baseOf(key, target);
    let next;
    if (spec.fontRank && key !== "numCantrips") {
      next = key === `numSpells${spec.fontRank}` ? Math.max(0, target + fontExtra) : 0;
    } else if (last === undefined) {
      next = Math.max(current, target);
      // A count the takeover raised, for the takeover notice
      if (auto.adopted && next > current) {
        auto.raisedFrom = { ...auto.raisedFrom, [key]: current };
      }
    } else if (rankGone(key, target)) {
      next = 0;
    } else {
      next = Math.max(0, target + current - last);
    }
    before[key] = current;
    if (next !== current) {
      entry.data[key] = next;
    }
    nextBase[key] = target;
  }

  // Spontaneous: slots remaining rise and fall with the slot count
  if (type === "spontaneous") {
    for (let rank = 1; rank <= 10; rank++) {
      const count = countOf(`numSpells${rank}`);
      const usedKey = `usedSpells${rank}`;
      const remaining = entry.data[usedKey];
      if (remaining === undefined || remaining === null || remaining === "") {
        if (count > 0) {
          entry.data[usedKey] = count;
        }
      } else if (count !== (before[`numSpells${rank}`] ?? count)) {
        entry.data[usedKey] = Math.min(
          count,
          Math.max(0, (parseInt(remaining, 10) || 0) + count - before[`numSpells${rank}`]),
        );
      }
    }
  }

  // Divine Font: the prepared heal or harm spells move up with its rank.
  // Anything else prepared there stays where it is.
  if (spec.fontRank) {
    const fontList = `spells${spec.fontRank}`;
    const fontSpell = new RegExp(`^(${(spec.spellFilter || ["heal", "harm"]).join("|")})$`, "i");
    const isFontSpell = (row) =>
      isFilledSpellRow(row) && fontSpell.test(`${row.name || ""}`.trim());
    const moved = [];
    for (let rank = 1; rank <= 10; rank++) {
      const list = `spells${rank}`;
      if (list === fontList || !(entry.data[list] || []).some(isFontSpell)) continue;
      moved.push(...entry.data[list].filter(isFontSpell));
      entry.data[list] = entry.data[list].filter((row) => !isFontSpell(row));
    }
    if (moved.length > 0) {
      const fontRows = entry.data[fontList] || [];
      entry.data[fontList] = [
        ...fontRows.filter(isFilledSpellRow),
        ...moved,
        ...fontRows.filter((row) => !isFilledSpellRow(row)),
      ];
    }
  }

  // Rows: empty prepared slots to match the counts, or repertoire placeholders
  // (kept the same way as counts, so a placeholder the player deleted stays
  // deleted). Spells already chosen stay, even in a rank that has no slots
  // left.
  SPELL_RANK_LISTS.forEach((list, rank) => {
    const rows = entry.data[list] || [];
    let wantRows;
    if (type === "prepared") {
      wantRows = countOf(rank === 0 ? "numCantrips" : `numSpells${rank}`);
    } else {
      const key = rank === 0 ? "repCantrips" : `rep${rank}`;
      const target = spec.repertoire?.[key];
      if (target === undefined) return;
      const last = baseOf(key, target);
      if (last === undefined) {
        wantRows = Math.max(rows.length, target);
      } else if (rankGone(key, target)) {
        wantRows = 0;
      } else {
        wantRows = Math.max(0, target + rows.length - last);
      }
      nextBase[key] = target;
    }
    const resized = resizeSpellRows(rows, wantRows, type, rank);
    if (resized !== rows) {
      entry.data[list] = resized;
    }
  });
  auto.base = nextBase;
  if (auto.offCounts) {
    auto.offCounts = null;
  }

  // Show the lists that have slots or spells. Lists the player showed or hid
  // themselves stay that way.
  const wanted = SPELL_RANK_LISTS.filter((list, rank) => {
    let count = countOf(`numSpells${rank}`);
    if (rank === 0) {
      count = type === "prepared" ? countOf("numCantrips") : 0;
    }
    return count > 0 || (entry.data[list] || []).length > 0;
  });
  const previous = auto.shown || [];
  const current =
    entry.data.shownSpells === undefined
      ? ["cantrips", "spells1"]
      : entry.data.shownSpells || [];
  const shown = SPELL_RANK_LISTS.filter((list) =>
    wanted.includes(list)
      ? !previous.includes(list) || current.includes(list)
      : current.includes(list) && !previous.includes(list),
  );
  const sameLists =
    shown.length === current.length && shown.every((list) => current.includes(list));
  if (!sameLists || entry.data.shownSpells === undefined) {
    entry.data.shownSpells = shown;
  }
  for (const list of SPELL_RANK_LISTS) {
    entry.fields[`${list}Box`] = { hidden: !entry.data.shownSpells.includes(list) };
  }
  auto.shown = wanted;
}

// Creates, sizes and updates the spellcasting entries the character's class
// gives (called by onAddEditFeature before updateSpellcastingEntries).
// Returns the updated list of entries; nothing is written until
// updateSpellcastingEntries.
function syncSpellcastingEntries(record, valuesToSet) {
  if (record.recordType !== "characters") {
    return null;
  }
  if (record.data?.spellcastingSyncVersion !== SPELLCASTING_SYNC_VERSION) {
    valuesToSet["data.spellcastingSyncVersion"] = SPELLCASTING_SYNC_VERSION;
  }
  const dismissed = record.data?.spellcastingDismissed || [];
  // Restore Automatic Entries shows once a managed entry was deleted, or
  // while several entries could be the class's or one holds its bonus slots
  // apart (it runs the takeover again)
  const showRestoreButton = (unresolved) => {
    const hideRestore = dismissed.length === 0 && !unresolved;
    if (record.fields?.restoreSpellcastingBtn?.hidden !== hideRestore) {
      valuesToSet["fields.restoreSpellcastingBtn.hidden"] = hideRestore;
    }
  };

  const entries = cloneRecordData(record.data?.spells || []);
  const level = parseInt(valuesToSet["data.level"] ?? record.data?.level ?? 0, 10) || 0;
  // Level 0 characters have no spellcasting until they take a class at 1st
  // level, so their entries are left alone
  if (isLevelZeroCharacter(record) || level < 1) {
    showRestoreButton(false);
    return entries;
  }

  const specs = getWantedSpellcastingEntries(record, level, valuesToSet);
  const classFont = specs.find((spec) => spec.fontRank) || null;
  // Whether the Divine Font gets a new entry, so font slots the player folded
  // into the class's entry move to it
  const fontSpec = specs.find(
    (spec) =>
      spec.fontRank &&
      !dismissed.includes(spec.source) &&
      !entries.some((e) => e.data?.auto?.source === spec.source),
  );
  const fontFound = fontSpec && findAdoptableSpellcastingEntry(entries, fontSpec, classFont);
  const fontIsNew = !!fontFound && !fontFound.entry && fontFound.ambiguous.length === 0;
  let fontSpells = [];
  let unresolved = false;
  // Specs with no entry to take over get a new one once every spec has had
  // its turn (see findMistypedClassEntry)
  const toAdd = [];

  for (const spec of specs) {
    if (dismissed.includes(spec.source)) continue;
    let entry = entries.find((e) => e.data?.auto?.source === spec.source);
    if (!entry) {
      // The class's bonus slots kept in an entry of their own: the class's
      // entry, taken over or added, would get them again, so none is until
      // the player deletes that entry, as the takeover notice says
      if (entries.some((e) => holdsBonusSpellSlots(e, spec))) {
        unresolved = true;
        continue;
      }
      const found = findAdoptableSpellcastingEntry(entries, spec, classFont);
      entry = found.entry;
      if (entry) {
        adoptSpellcastingEntry(record, entry, valuesToSet);
        // A font's entry under the popover's name, which the class's entry
        // often has too ("Divine Prepared Spells"), is named for the font
        if (spec.fontRank && isDefaultSpellcastingEntryName(entry.name)) {
          entry.name = spec.name;
        }
        if (fontIsNew && spec.source === fontSpec.source.replace(/:font$/, "")) {
          fontSpells = moveDivineFontSlots(entry, spec, fontSpec);
        }
      } else if (found.ambiguous.length > 0) {
        // Several entries could be the class's: none is taken over or added
        // until the player names the one to use, as the takeover notice says
        unresolved = true;
        continue;
      } else {
        toAdd.push(spec);
        continue;
      }
    }
    applySpellcastingSpec(entry, spec);
  }
  for (const spec of toAdd) {
    if (findMistypedClassEntry(entries, spec)) {
      // The class's entry set to the other way of casting: none is added
      // until the player sets its type, as the takeover notice says
      unresolved = true;
      continue;
    }
    const entry = buildSpellcastingEntry({
      name: spec.name,
      type: spec.type,
      tradition: spec.tradition || "",
      attribute: spec.attribute,
      training: spec.training,
      shownSpells: [],
      isFirst: entries.length === 0,
    });
    if (spec.fontRank && fontSpells.length > 0) {
      entry.data[`spells${spec.fontRank}`] = fontSpells;
    }
    // The class's other entries (Divine Font, apparitions) cast with its
    // spell DC, so they start at the rank its entry keeps as its own
    const classSource = spec.source.split(":").slice(0, 2).join(":");
    const classEntry = entries.find((e) => e.data?.auto?.source === classSource);
    const ownTraining = parseInt(classEntry?.data?.auto?.ownTraining || "0", 10) || 0;
    if (ownTraining > 0) {
      entry.data.auto = { ownTraining };
    }
    entries.push(entry);
    applySpellcastingSpec(entry, spec);
  }
  showRestoreButton(unresolved);

  // Entries whose class or feature is gone: removed while they hold no
  // spells, otherwise kept and no longer managed
  const wantedSources = specs.map((spec) => spec.source);
  const firstId = entries[0]?._id;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!isManagedSpellcastingEntry(entry) || wantedSources.includes(entry.data.auto.source)) {
      continue;
    }
    const hasSpells =
      SPELL_RANK_LISTS.some((list) => (entry.data[list] || []).some(isFilledSpellRow)) ||
      (entry.data.knownSpells || []).length > 0;
    if (hasSpells) {
      entry.data.auto.orphaned = true;
      entry.fields = { ...entry.fields, autoSlots: { hidden: true } };
    } else {
      entries.splice(i, 1);
    }
  }
  if (entries.length > 0 && entries[0]._id !== firstId) {
    entries[0].fields = { ...entries[0].fields, moveUpBtn: { hidden: true } };
  }

  // The first takeover of a character's own entries can run from any action
  // that recalculates the sheet, on the GM's client as well, so its notice is
  // kept on the record and shown when the owner next opens it
  const oldEntries = record.data?.spells || [];
  if (
    record.data?.spellcastingSyncVersion !== SPELLCASTING_SYNC_VERSION &&
    oldEntries.length > 0
  ) {
    const notice = describeSpellcastingSync(oldEntries, {
      ...record,
      data: { ...record.data, level, spells: entries },
    });
    if (notice) {
      valuesToSet["data.spellcastingNotice"] = notice;
    }
  }
  return entries;
}

// Whether the person viewing a record is its owner. When Realm doesn't say
// who owns it or who is viewing, they're taken to be.
function isRecordOwner(record) {
  const viewer = typeof userId !== "undefined" ? userId : null;
  if (!viewer || !record?.ownerId) {
    return true;
  }
  return `${record.ownerId}` === `${viewer}`;
}

// Shows the takeover notice kept on a character (see syncSpellcastingEntries)
// and clears it once its owner has seen it. `showToEditor` also shows it to
// the GM, when their opening the sheet ran the takeover.
function showSpellcastingNotice(record, showToEditor = false) {
  const notice = record?.data?.spellcastingNotice;
  const owner = isRecordOwner(record);
  if (!notice || !(owner || (showToEditor && canEditRecord(record)))) {
    return;
  }
  api.showNotification(notice, "blue", "Spellcasting");
  if (owner) {
    api.setValues({ "data.spellcastingNotice": null });
  }
}

// Characters made before the sheet sized spellcasting entries from the class
// (or under an older version of it) are synced once when their sheet opens
function needsSpellcastingSync(record) {
  return record?.data?.spellcastingSyncVersion !== SPELLCASTING_SYNC_VERSION;
}

// Whether the person viewing a record can save changes to it: the GM, or the
// player who owns it. Anyone else (a player looking at a party member's
// sheet) can't, so updates made when a sheet opens wait for one of them.
// When Realm doesn't say who owns the record or who is viewing, it's assumed
// they can.
function canEditRecord(record) {
  if (typeof isGM !== "undefined" && isGM) {
    return true;
  }
  const viewer = typeof userId !== "undefined" ? userId : null;
  if (!viewer || !record?.ownerId) {
    return true;
  }
  return `${record.ownerId}` === `${viewer}`;
}

// The notice shown after a sync that took a character's entries over, from
// the entries before it and the record after it: entries taken over and
// added, what a takeover kept or moved, and class entries that couldn't be
// told apart from others. Entries are matched by source, not by their place
// in the list.
function describeSpellcastingSync(oldEntries, record) {
  const entries = record?.data?.spells || [];
  const oldSources = new Set(
    (oldEntries || []).map((entry) => entry?.data?.auto?.source).filter(Boolean),
  );
  const fresh = entries.filter(
    (entry) => isManagedSpellcastingEntry(entry) && !oldSources.has(entry.data.auto.source),
  );
  const adopted = fresh.filter((entry) => entry.data.auto.adopted);
  const added = fresh.filter((entry) => !entry.data.auto.adopted);
  const join = (names) =>
    names.length <= 1
      ? names.join("")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const level = parseInt(record?.data?.level || 0, 10) || 0;
  const specs = getWantedSpellcastingEntries(record, level);
  const messages = [];
  // An innate entry taken over (a Divine Font kept that way) has no slot
  // counts to follow
  const following = adopted.filter((entry) => entry.data.type !== "innate");

  if (following.length > 0) {
    const names = following.map((entry) => entry.name);
    const verb = names.length === 1 && !/s$/i.test(names[0]) ? "follows" : "follow";
    messages.push(
      `${join(names)} now ${verb} your level (higher counts kept). To stop this, uncheck "Set slots from level" in ${names.length === 1 ? "its" : "each one's"} settings.`,
    );
  }
  for (const entry of adopted) {
    const auto = entry.data.auto;
    if (!following.includes(entry)) {
      messages.push(
        `${entry.name} stays innate, so its slots don't follow your level. To have them follow, change its type to prepared in its settings.`,
      );
    }
    const tradition = `${entry.data.tradition || ""}`;
    const classTradition = `${auto.tradition || ""}`;
    if (classTradition && tradition && tradition.toLowerCase() !== classTradition.toLowerCase()) {
      messages.push(
        `${entry.name} kept its ${tradition} tradition. Your class casts ${classTradition.toLowerCase()} spells, so change it in its settings if that was a mistake.`,
      );
    }
    // Counts raised to the class's next to an entry of the type left as it
    // was, which may hold some of those slots already (a school's slots kept
    // apart without its cantrip)
    const raised = Object.entries(auto.raisedFrom || {}).map(([key, from]) => {
      const label =
        key === "numCantrips"
          ? "cantrips"
          : `${getOrdinal(parseInt(key.replace("numSpells", ""), 10))}-rank slots`;
      return `${label} ${from} to ${parseInt(entry.data[key] || 0, 10) || 0}`;
    });
    const type = entry.data.type || "prepared";
    const leftOfType = entries.some(
      (other) => !other.data?.auto?.source && (other.data?.type || "prepared") === type,
    );
    if (raised.length > 0 && leftOfType) {
      messages.push(
        `${entry.name} was raised to your class's counts (${join(raised)}). If another entry already holds some of these slots, lower them in ${entry.name}.`,
      );
    }
    if (auto.fontSlotsMoved) {
      messages.push(
        `${plural(auto.fontSlotsMoved, "Divine Font slot")} in ${entry.name} moved to the new Divine Font entry.`,
      );
    }
    // Slots kept over the class's next to a new Divine Font entry may be
    // font slots counted twice
    const fontSource = `${auto.source}:font`;
    if (!added.some((e) => e.data.auto.source === fontSource)) {
      continue;
    }
    const extras = [];
    for (let rank = 1; rank <= 10; rank++) {
      const key = `numSpells${rank}`;
      const extra = (parseInt(entry.data[key] || 0, 10) || 0) - (auto.base?.[key] || 0);
      if (extra > 0) {
        extras.push(plural(extra, `${getOrdinal(rank)}-rank slot`));
      }
    }
    if (extras.length > 0) {
      messages.push(
        `${entry.name} kept ${join(extras)} over your class's. If these are Divine Font slots, lower the count: Divine Font has its own entry now.`,
      );
    }
  }
  if (added.length > 0) {
    messages.push(`Added from your class: ${join(added.map((entry) => entry.name))}.`);
  }
  // Next to a new Divine Font entry, an entry left as it was with no cantrips
  // and slots at one rank may be the font kept by hand at an older level's
  // rank or count, or with other spells prepared
  const newFont = added.find((entry) => entry.data.auto.source.endsWith(":font"));
  const newFontSpec = newFont && specs.find((spec) => spec.source === newFont.data.auto.source);
  for (const entry of newFontSpec ? entries : []) {
    // Named for the font but holding other spells too: left as it was
    if (
      !entry.data?.auto?.source &&
      isDivineFontName(entry.name) &&
      !/dedication|archetype/i.test(`${entry.name || ""}`) &&
      !["focus", "item"].includes(entry.data?.type)
    ) {
      messages.push(
        `${entry.name} was left as it was, as it holds spells other than heal or harm. If it holds Divine Font slots, lower them there: ${newFont.name} has its own entry now.`,
      );
      continue;
    }
    const countOf = (key) => parseInt(entry.data?.[key] || 0, 10) || 0;
    const ranks = [];
    for (let rank = 1; rank <= 10; rank++) {
      if (countOf(`numSpells${rank}`) > 0) ranks.push(rank);
    }
    const count = ranks.length === 1 ? countOf(`numSpells${ranks[0]}`) : 0;
    if (
      !entry.data?.auto?.source &&
      (entry.data?.type || "prepared") === "prepared" &&
      countOf("numCantrips") === 0 &&
      (entry.data?.cantrips || []).length === 0 &&
      count * 2 >= (newFontSpec.counts[`numSpells${newFontSpec.fontRank}`] || 1)
    ) {
      messages.push(
        `${entry.name}, left as it was, holds ${plural(count, `${getOrdinal(ranks[0])}-rank slot`)}. If these are Divine Font slots, delete it: ${newFont.name} has its own entry now.`,
      );
    }
  }

  const dismissed = record?.data?.spellcastingDismissed || [];
  const classFont = specs.find((spec) => spec.fontRank) || null;
  for (const spec of specs) {
    if (
      dismissed.includes(spec.source) ||
      entries.some((entry) => entry.data?.auto?.source === spec.source)
    ) {
      continue;
    }
    // Named with their counts, as the class's entry may have the same name
    const apart = entries
      .filter((entry) => holdsBonusSpellSlots(entry, spec))
      .map((entry) => {
        const ranks = [];
        for (let rank = 1; rank <= 10; rank++) {
          if ((parseInt(entry.data[`numSpells${rank}`] || 0, 10) || 0) > 0) ranks.push(rank);
        }
        const counts =
          spec.bonus === "school"
            ? `1 cantrip and ${plural(ranks.length, "slot")}`
            : plural(2, `${getOrdinal(ranks[0])}-rank slot`);
        return `${entry.name} (${counts})`;
      });
    if (apart.length > 0) {
      const slots = spec.bonus === "school" ? "school slots" : "studious spell slots";
      messages.push(
        `${join(apart)} ${apart.length === 1 ? "holds" : "hold"} your ${slots} apart from the rest, so no entry was taken over or added for "${spec.name}" (it would count them again). To have your slots follow your level, delete ${apart.length === 1 ? "it" : "them"}, then click Restore Automatic Entries (under Add Spellcasting Entry).`,
      );
      continue;
    }
    const mistyped = findMistypedClassEntry(entries, spec);
    const found = findAdoptableSpellcastingEntry(entries, spec, classFont);
    if (mistyped && !found.entry && found.ambiguous.length === 0) {
      messages.push(
        `${mistyped.name} looks like your ${spec.name.replace(/ Spells$/, "")} entry but is set to ${mistyped.data?.type || "prepared"}, so "${spec.name}" wasn't added (it would double your slots). Set ${mistyped.name} to ${spec.type} in its settings, then click Restore Automatic Entries (under Add Spellcasting Entry).`,
      );
      continue;
    }
    const { ambiguous } = found;
    if (ambiguous.length > 1) {
      const word = spec.name.replace(/ Spells$/, "");
      const advice = ambiguous.some((entry) => isNamedForSpellcastingSpec(entry, spec))
        ? `Keep "${word}" in the name of only the one to use`
        : `Add "${word}" to the name of the one to use`;
      messages.push(
        `${join(ambiguous.map((entry) => entry.name))} could each be the class entry "${spec.name}", so none was taken over or added. ${advice}, then click Restore Automatic Entries (under Add Spellcasting Entry).`,
      );
    }
  }
  return messages.join(" ");
}

// Names the Add Spellcasting Entry popover gives ("Arcane Prepared Spells").
// These follow the entry's settings; any other name is the player's own.
function isDefaultSpellcastingEntryName(name) {
  return (
    !name ||
    /^(Arcane|Divine|Occult|Primal) (Prepared|Spontaneous|Innate|Focus|Item) Spells$/.test(
      name,
    )
  );
}

// "1st", "2nd", "3rd", "4th" ...
function getOrdinal(number) {
  const suffixes = { 1: "st", 2: "nd", 3: "rd" };
  const lastTwo = number % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : suffixes[number % 10] || "th";
  return `${number}${suffix}`;
}

// Level Up summary lines for the class's spell slots, e.g. "Wizard Spells:
// 2nd-rank spells (3 slots)" or "Divine Font moves to 3rd rank (5 slots)"
function getSpellcastingLevelUpChanges(record, newLevel) {
  const dismissed = record.data?.spellcastingDismissed || [];
  const entries = record.data?.spells || [];
  const before = getWantedSpellcastingEntries(record, newLevel - 1);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const lines = [];

  for (const spec of getWantedSpellcastingEntries(record, newLevel)) {
    const entry = entries.find((e) => e.data?.auto?.source === spec.source);
    if (dismissed.includes(spec.source) || entry?.data?.autoSlots === false) continue;
    const old = before.find((s) => s.source === spec.source);
    const name = entry?.name || spec.name;

    if (spec.fontRank) {
      const count = spec.counts[`numSpells${spec.fontRank}`];
      if (old?.fontRank !== spec.fontRank) {
        lines.push(`${name} moves to ${getOrdinal(spec.fontRank)} rank (${plural(count, "slot")})`);
      } else if (old.counts[`numSpells${spec.fontRank}`] !== count) {
        lines.push(`${name}: ${plural(count, "slot")}`);
      }
      continue;
    }

    const parts = [];
    const cantrips = (spec.counts.numCantrips || 0) - (old?.counts.numCantrips || 0);
    if (cantrips > 0) {
      parts.push(`+${plural(cantrips, "cantrip")}`);
    }
    for (let rank = 1; rank <= 10; rank++) {
      const was = old?.counts[`numSpells${rank}`] || 0;
      const now = spec.counts[`numSpells${rank}`] || 0;
      const label = `${getOrdinal(rank)}-rank`;
      if (now > was && was === 0) {
        parts.push(`${label} spells (${plural(now, "slot")})`);
      } else if (now > was) {
        parts.push(`+${now - was} ${label} slot${now - was === 1 ? "" : "s"}`);
      } else if (now < was && now === 0) {
        parts.push(`no more ${label} slots`);
      } else if (now < was) {
        parts.push(`-${was - now} ${label} slot${was - now === 1 ? "" : "s"}`);
      }
    }
    if (spec.repertoire) {
      let spells = 0;
      for (let rank = 1; rank <= 10; rank++) {
        spells += Math.max(
          0,
          spec.repertoire[`rep${rank}`] - (old?.repertoire?.[`rep${rank}`] || 0),
        );
      }
      const newCantrips = spec.repertoire.repCantrips - (old?.repertoire?.repCantrips || 0);
      if (spells > 0) {
        parts.push(`learn ${plural(spells, "spell")}`);
      }
      if (newCantrips > 0) {
        parts.push(`learn ${plural(newCantrips, "cantrip")}`);
      }
    }
    if (parts.length > 0) {
      lines.push(`${name}: ${parts.join(", ")}`);
    }
  }
  return lines;
}
