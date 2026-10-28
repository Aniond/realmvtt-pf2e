# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication

- Answer at the altitude asked. Do not restate what the code already shows.
- Do not narrate steps as you take them, and do not explain reasoning that was not requested.
- Report what changed and anything that broke or is still outstanding. Skip the rest — no preamble, no recap of small edits, no summarizing the summary.

## Overview

This is a Pathfinder 2nd Edition ruleset implementation for Realm VTT. The codebase consists of HTML files with embedded JavaScript that interact with the Realm VTT API.

**Important**: This ruleset uses the Realm VTT API (https://www.realmvtt.com/wiki/ruleset-editor-and-api). HTML and JavaScript must be written to conform to this API. Field values cannot be directly embedded into HTML - all data access must go through the API.

## Architecture

### Data Path System

- `dataPath` - Current field's data path context
- `getNearestParentDataPath(dataPath)` - Navigate to parent object in data hierarchy
- `record` - The current record being edited
- Field paths use dot notation: `data.ancestries`, `fields.levelLabel.hidden`

### Modifier System - Critical for All Rolls

**Always check for relevant modifiers before making any roll** using `getEffectsAndModifiersForToken`:

```javascript
getEffectsAndModifiersForToken(record, modifierTypes, field, itemId, appliedById)
```

**Parameters**:
- `record` - The character/token record
- `modifierTypes` - Array of modifier types (e.g., `['saveBonus', 'savePenalty']`)
- `field` - **Third parameter (often required)** - The relevant field/context (e.g., 'fortitude', 'dex', 'perception')
- `itemId` - Fourth parameter - Only for attack rolls with specific items
- `appliedById` - Fifth parameter - Only when checking for effects from specific tokens

**Implementation Pattern**:
1. Always make TWO modifier checks:
   - Specific modifiers for the roll type
   - General modifiers using `['allBonus', 'allPenalty']` with the relevant attribute

2. Example for saving throws:
```javascript
// Get save-specific modifiers (e.g., fortitude bonus)
const saveMods = getEffectsAndModifiersForToken(
  record,
  ['saveBonus', 'savePenalty'],
  saveType // 'fortitude', 'reflex', or 'will'
);

// Get attribute-based all modifiers
const allMods = getEffectsAndModifiersForToken(
  record,
  ['allBonus', 'allPenalty'],
  attribute // 'con' for fort, 'dex' for reflex, 'wis' for will
);
```

**Note**: The field parameter may not be relevant for all modifier types, but include it when there's a relevant context.

### UI Conventions

- Lists use `_id` field with `generateUuid()` for unique identifiers
- Trait objects structure: `{ _id, name, identified, data }`
- Hidden field control via `fields.[fieldname].hidden` properties
- Conditional visibility based on data values

## Development Guidelines

### Working with HTML Files

1. All JavaScript must be within `<script>` tags in the HTML files
2. Functions can reference the global `record`, `dataPath`, and `api` objects
3. Use `api.setValues()` for all data modifications - never modify data directly
4. Always provide callbacks when chaining operations that depend on data updates

Fields such as `onload` and `onchange` only work on Realm VTT field HTML, not on plain elements like `div` or `span`.

### Adding New Features

1. Check existing patterns in similar files (e.g., other `-main.html` or `-list.html` files)
2. Use `generateUuid()` when adding items to lists
3. Implement `showHideFields()` for dynamic UI elements
4. Handle drag-and-drop via `onDrop()` functions

### Modifying Game Mechanics

1. Core mechanics are in `rollhandlers/common.js`
2. Proficiency calculations, ability scores, and modifiers are centralized
3. Use `onAddEditFeature()` to trigger recalculations after data changes

### Attack Log (multiple attack penalty, momentum traits)

`rollhandlers/attack-log.js` counts the attacks a creature makes on its own turn. It suggests and never enforces, since players make mistakes:

- Strikes keep their 1st/2nd/3rd buttons, which always set the penalty. The card doesn't compare the button with the count: a player can roll again before the last roll's result is logged, so the count can lag behind.
- Spell attacks and attack-trait skill actions (Grapple, Trip...) get the penalty from the count as a ticked modifier that can be unticked in the roll prompt.
- Forceful, twin, sweep and backswing apply from the earlier attacks, also as ticked modifiers.

Storage:

- `onTurnStart` sets the campaign variable `pf2eTurn` to `{ key, round, tokenId, recordId }`. The same token's turn starting again in the same round (Next after Previous) keeps the key and so the turn's log; any other turn start gets a new key. `onEncounterEnd` clears it, so a new encounter always starts a new log.
- The log is on the attacker's token at `data.turnAttacks` (`{ turnKey, attacks }`). It is written only by the result handlers (`attack.js`, `skill.js`) from `metadata.turnAttack`, which carries the log as it was at roll time. A log whose `turnKey` isn't the current turn's is ignored.

When adding a new kind of attack roll, pass `turnAttack` (from `getTurnAttackMetadata`) in the roll metadata and call `logTurnAttack` in its result handler. Attacks on another creature's turn (reactions) are not logged and take no penalty from the log.

### Action Limits (flourish, stance, press, finisher, spellshape...)

`rollhandlers/action-limits.js` keeps the actions and spells a creature uses on its own turn, for the same turn key as the attack log, on its token at `data.turnActions` (`{ turnKey, uses }`). It also warns and never blocks: the card gets a bold line and a notice, and the use still goes ahead.

- `checkActionLimits(creature, token, name, traits, kind)` is called by `useAction` (kind `"action"`) and `castSpell` (kind `"spell"`). It returns the card's lines and logs the use.
- Flourish, stance and overflow are once per round; hex and composition once per turn. Press needs an attack already this turn (the attack log) and the creature's own turn.
- After a finisher, attack-trait actions, Strikes, spell attacks and maneuvers get a warning (`getAfterFinisherWarning`, carried as `metadata.attackNumberHint`), but only once an attack has been logged after the finisher: the finisher's own Strike is part of it.
- An overlay cast (`castSpell(..., isOverlay = true)`) is a variant of the spell just cast, so it is neither checked nor logged.
- A spellshape (legacy: metamagic) puts a note on the next spell's card, or says it was wasted when another action or attack came between.
- A composition is remembered at `data.lastComposition` (`{ name, round }`); a different one cast within 4 rounds says the old one ends.
- Applying a `Stance: ...` effect (`applyEffectButton`) first removes the creature's other `Stance: ...` effects.

### Basic Saves (applied per target)

`rollhandlers/basic-saves.js` lets one damage roll be applied to many creatures by each one's own basic save.

- `rollSave` puts the saver's token in the roll metadata (`saverTokenId`, from `getSaverTokenRef`), and `basicSave: true` when the save button passed `{ basic: true }` (`getSaveMacro`'s `basic` argument; spells with the Basic box).
- `save.js` keeps the result on that token at `data.lastSave` (`{ degree, saveType, dc, time }`), and a basic save's card says what damage it takes.
- A damage card with `metadata.basicSave` (`{ saveType, useId }`) has an Apply by Saves button. A spell's damage button sets it from the Basic box. An ability's damage buttons (`executeDamageMacro`) get it from `updateDamageMacros` when the description's save button is basic: the module converter writes `rollSavingThrow('reflex', 28, { basic: true })` for Foundry's `@Check[reflex|dc:28|basic]`, with `undefined` for the DC of one without a DC. Older imports without the flag get no button. `applyDamageBySaves` applies it to each selected creature by its last save from the past 10 minutes (of the spell's save type, when known): none, half, full or double. It posts what each took and marks the save with the use id: every damage button of one use (one card) shares the id, so a save covers all of that use's damage parts but not a later use.

### Scrolls and Wands (casting from items)

`rollhandlers/item-spells.js` lets Use on a scroll or wand cast its spell with the character's own spellcasting.

- A scroll or wand is found by its `scroll`/`wand` trait or item category (`getItemSpellKind`), never by its uses. Its spell is the Spell field or the first spell its description links (looked up by id, then by name); its rank is the Level field, "(3rd-Rank Spell)" in its name, or "at 3rd-rank" in its text.
- A character with a prepared or spontaneous entry of the spell's tradition casts it through an automatic "Scrolls and Wands" entry (type `item`, `data.itemSpells: true`). Every cast copies the DC, attack, attribute and tradition from their best matching entry, and puts the spell at `spells<rank>` (the same spell reuses its row), then calls `castSpell`. Only that entry is written (`data.spells.<index>`, with the item's use; `api.addValue` the first time), never the whole list. A character's entry that already lists the spell also counts (Foundry's `canCast`).
- Anything that walks `data.spells` must leave that entry out of slots, uses and refills (`isItemSpellsEntry`); `rest` skips it, and the class sync and recalculation already leave unmanaged `item` entries alone.
- Without the tradition, it casts with Trick Magic Item's DC and attack (Player Core pg. 264: level as proficiency, the highest of Int, Wis and Cha), for casters of another tradition too, and the card says so; the GM asks for the check if the table wants it.
- A scroll is used up (removed at 0 when it auto-destroys, then bulk is worked out again); a wand spends `uses.value`, which `getWandRecharges` refills at daily preparations. A spent wand still casts, with an overcharge warning.

### Data Structure

- Character data is nested under `record.data`
- UI state is under `record.fields`
- Lists (traits, features, etc.) typically have both array and object representations
- Always check for existing data before initializing defaults

## Realm VTT API Reference

See the `realm-vtt-api` skill for the API surface (data management, dice rolling, token management), the roll-type and metadata rules, and recipes for adding character options, calculations, and UI components.

## Language

All writing uses **American English**. This covers UI copy, marketing text, docs,
comments, commit messages, and anything else that ships. No British English:
write "color" not "colour", "organization" not "organisation", "math" not
"maths", "license" not "licence", "traveling" not "travelling", "gray" not
"grey". No em dashes in user-facing copy either.
