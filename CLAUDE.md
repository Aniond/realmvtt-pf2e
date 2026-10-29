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

### Stances and the action economy

`rollhandlers/action-limits.js` only swaps stances: applying a `Stance: ...` effect (`applyEffectButton`) first removes the creature's other `Stance: ...` effects. The ruleset doesn't police the action economy (flourish, press, finisher, hex, composition, spellshape): no warnings and no per-turn action log. The GM runs those at the table.

### Basic Saves (applied per target)

`rollhandlers/basic-saves.js` lets one damage roll be applied to many creatures by each one's own basic save.

- `rollSave` puts the saver's token in the roll metadata (`saverTokenId`, from `getSaverTokenRef`), and `basicSave: true` when the save button passed `{ basic: true }` (`getSaveMacro`'s `basic` argument; spells with the Basic box).
- `save.js` keeps the result on that token at `data.lastSave` (`{ degree, saveType, dc }`), and a basic save's card says what damage it takes.
- A damage card with `metadata.basicSave` (`{ saveType }`) has an Apply by Saves button. A spell's damage button sets it from the Basic box. An ability's damage buttons (`executeDamageMacro`) get it from `updateDamageMacros` when the description's save button is basic: the module converter writes `rollSavingThrow('reflex', 28, { basic: true })` for Foundry's `@Check[reflex|dc:28|basic]`, with `undefined` for the DC of one without a DC. Older imports without the flag get no button. `applyDamageBySaves` applies it to each selected creature by its most recent save (no time limit and no save-type check; the card names the save it used): none, half, full or double. Each damaged creature's damage card is headed by one bold line ("Fireball: applied by Reflex failure, full damage"); the rest share one card. A save is never marked used, so it can be applied again (another damage part, or redoing it).

### Animal companions (characters)

Animal companions are characters, as Foundry's PF2e Companion Compendia builds them. Their ancestry is the companion type, their class is "Animal Companion", and their stages (Mature, Nimble, Savage, Specialized) are feats, all in a data module. `rollhandlers/animal-companions.js` holds the ruleset's part; common.js calls it:

- `isAnimalCompanionCharacter`: the class is named Animal Companion, or has `data.animalCompanion: true`. Such a character:
  - has no Automatic Bonus Progression (`isAbpCharacter`) and gains no attribute boosts at Level Up (`getLevelUpGains`)
  - benefits only from item bonuses to AC and Speed (`withoutAnimalCompanionItemBonuses`, in `getEffectsAndModifiersForToken`; an effect rule's `-item` suffix is stripped first)
  - gets at most +3 to AC from item bonuses all told: its armor's (barding's, potency included, `getACForArmor`), and the rest of the +3 for any other
  - shows no free boost fields when its level is typed in by hand (`getFreeBoostFieldsForLevel`)
- Its attributes are `attributeBonus` modifiers on the ancestry's feature. Its ancestry has no boosts or flaws. `attributeBonus` values are added as numbers, and inactive ones are skipped.
- Modifiers the module's feats use:
  - `weaponDiceCount`: the number of base damage dice for matching weapons (`getAlteredWeapon`), the highest wins. Striking runes still add to it. Mature uses 2 and Specialized 3, with predicate `["item:category:unarmed"]`.
  - `creatureSize` value `"+1"`: one size larger, up to Large, adding up and counting from the ancestry's size (`getFeatureCreatureSize`). The rules say "grows by one size if it's Medium or smaller".
- The Notes tab shows an Animal Companion box only for a companion (`fields.companionProperties`, set in `onAddEditFeature`). It has the master (`data.companionMaster`) and a Match Master's Level button. Choosing the master, or the button, sets the companion's level to the master's (`syncCompanionLevel`) and works the sheet out again. There's no level-up hook, so a master's Level Up doesn't reach it on its own.
- Pictures:
  - Dropping a companion ancestry gives the character the ancestry's portrait, and its `data.tokenImage` (or portrait) as the token image. This only fills a picture that's still empty or a placeholder (`getCompanionImageValues`).
  - The Notes tab's **Use art from creature** picker copies any NPC's portrait and token (`onCompanionArtChange`), so a table's own licensed creature art can be used; the module ships none.
- Rules choices:
  - The module's README lists them under "Rules notes".
  - A specialization's "master if it was already expert from its type" is read literally: a savage Bully's Athletics stays expert, where Foundry raises it to master.
  - Barding is modeled as light and heavy armor proficiency.
  - No ABP is Foundry's convention, not a printed rule.
- Companions skip the creation wizard, which requires a key attribute and boosts. You make one by dropping the ancestry and the class on a new character.

### Concealment and detection

`rollhandlers/concealment.js` (Player Core pg. 442-447): a Strike or spell attack against a concealed target (DC 5), or a hidden, invisible or undetected one (DC 11), or from a dazzled (DC 5) or blinded (DC 11) attacker, carries the worst flat check as `metadata.concealment`. `attack.js` shows it as a line and a Flat Check button; nothing is rolled or refused automatically. A hidden, invisible or undetected attacker makes its target off-guard, applied to the AC as flanking is. Effects aren't per observer, so a condition on a token counts against everyone; the GM removes it when it no longer applies.

### Immunities, weaknesses and resistances

`applyDamage` reads them from `getIWR` and matches each damage type, then the roll's `metadata.damageCategories`. The categories follow Foundry's IWR types (`actor/data/iwr.ts`):

- "physical" means bludgeoning, piercing and slashing. "energy" means acid, cold, electricity, fire, sonic, force, vitality and void. Both are expanded into those types (`IWR_DAMAGE_GROUPS`) in the IWR lists, in "ignore ... resistance" modifiers and in suppressIWR.
- `withDamageCategories` adds the categories a roll's types don't carry:
  - "spells" for damage from a spell
  - "holy" or "unholy" when the attack or spell has that trait
  - "area-damage" when its source has an area: `getDamageSource` sets `damageSource.area` from `data.area`, and `updateDamageMacros` also from the ability's text ("in a 30 ft. Cone", `hasAreaText`), since the converted NPC data keeps the area only there. A bare NPC `executeDamageMacro('formula', 'category', 'name')` gets a context (`damageSource`, plus `basicSave` when there is one) when it has a basic save or an area.
  - "splash-damage" on a hit whose damage includes splash (`metadata.splashDamage`) and when splash damage is applied on its own
- Weaknesses are checked for each damage type in the hit. Of those that apply to a type (its own, all damage, then each category), only the highest is added, with exceptions and doubleVs counted first: a demon weak to cold iron 5 and holy 5 takes +5 from a holy cold-iron weapon. A precision weakness is part of that choice for the type the precision damage rides on.
- Legacy data reads as remaster:
  - Damage types: positive becomes vitality and negative becomes void. Good and evil damage becomes spirit damage with the holy or unholy category.
  - Weaknesses, resistances and immunities: positive and negative become vitality and void, and good and evil become holy and unholy, keeping the stronger of a legacy entry and a remaster one.
  - Lawful and chaotic stay as they are.
- A token immune to a condition is asked about it (`getConditionImmunity` in `addConditionGain`, which every Apply button and maneuver goes through): its immunities list names the condition, or object immunities cover it. Vehicles and hazards have object immunities whether or not their data lists them (Foundry adds them to every hazard), nonlethal attacks among them. The GM can apply it anyway; nothing is refused.

### Scrolls and Wands (casting from items)

`rollhandlers/item-spells.js` lets Use on a scroll or wand cast its spell with the character's own spellcasting.

- A scroll or wand is found by its `scroll`/`wand` trait or item category (`getItemSpellKind`), never by its uses. Its spell is the Spell field or the first spell its description links (looked up by id, then by name); its rank is the Level field, "(3rd-Rank Spell)" in its name, or "at 3rd-rank" in its text.
- An automatic "Scrolls and Wands" entry (type `item`, `data.itemSpells: true`) follows the inventory: one row per scroll and wand at the item's rank, whose uses show the wand's use for the day or the scroll's count, and whose `data.itemSpell` (`{ itemId, itemIndex, itemName, kind, spellId }`) names its item. `syncItemSpells` brings it up to date when a scroll or wand is added (dropped on the sheet), equipped, counted, deleted or used; it reads the record again first, writes only the entry (`data.spells.<index>`; `api.addValue` when new, `api.removeValue` when none are left) and only when it changed. It never runs on sheet open. Realm runs every click as a script of its own (a fresh sandbox; top-level variables don't carry over), so two syncs can overlap and can't wait for each other. Each writes against a record it has just read (again after any spell look-up), only when something changed, and removes by id with `api.removeValueFromRecord` on that read (Realm pulls by `_id`, so two removing at once remove once; plain `api.removeValue` maps the index on the record bound when the script started, which can be stale). Two adding at once can leave a second entry; each sync reads again after writing and removes any but the first. A used-up scroll is found again by its id before it's removed, and stays if it's gone or restocked.
- Casting from a row (from the entry, or Use on the item, which syncs and casts the row) goes through `castSpell`: `getItemSpellCast` works out the caster's numbers for that spell (their best prepared or spontaneous entry of its tradition, or one that already lists it, Foundry's `canCast`) and spends the row's item, all in castSpell's one write, and the card says which item and with what. It never refuses: a spent wand still casts, with an overcharge line. An overlay spends nothing. A row from before rows named their item finds it by the spell's name.
- Anything that walks `data.spells` must leave that entry out of slots, uses and refills (`isItemSpellsEntry`); `rest` skips it, and the class sync and recalculation already leave unmanaged `item` entries alone.
- Without the tradition, it casts with Trick Magic Item's DC and attack (Player Core pg. 264: level as proficiency, the highest of Int, Wis and Cha), for casters of another tradition too, and the card says so; the GM asks for the check if the table wants it.
- A scroll is used up (removed at 0 when it auto-destroys, with its row, then bulk is worked out again); a wand spends `uses.value`, which `getWandRecharges` refills at daily preparations, along with its row's uses.

### GM tools (XP, advancement, initiative, DCs)

`rollhandlers/gm-tools.js`:

- Encounter XP (`getEncounterXp`, used by `onEncounterEnd.js`): the creature table from -4 to +4, or from -7 to +7 under Proficiency without Level (Foundry's `xpVariantCreatureDifferences`). Below the table: 0 XP. Above it: the table's highest. A simple hazard always uses the standard simple-hazard table (2 to 32, as Foundry's `getHazardXp`), and a complex hazard uses the creature table.
- Advancement speed: the campaign setting `advancementSpeed` (standard, fast, slow, milestone) feeds `getXpToNextLevel`. The XP bar's `maxvaluefield` is `data.xpToNextLevel`, which `onLoadCharacter` writes once (`getXpBarValues`). Story milestones return 0 XP, so Level Up always shows (it confirms), and the XP bar hides.
- Initiative:
  - A hazard rolls Stealth (`getInitiativeSkill`). Its Stealth modifier is `data.stealth.value`, which the converter copies from Foundry's `system.attributes.stealth.value` (`getHazardStealthMod`, used in `rollSkill` and the NPC sheet). The DC is that plus 10.
  - An adversary that ties a PC goes first. The tracker sorts on `data.initiative` alone, so `initiative.js` stores an enemy's roll plus 0.1 (`getInitiativeValue`). The roll's metadata says which tokens are adversaries; a roll from a sheet uses the sheet's token faction (`api.getToken()`) when there is one.
- DCs: `getSimpleDC(rank)`, `getDCAdjustment` (rarity maps to hard, very hard or incredibly hard) and `getDCForLevel` (PF2e.js). `showDCHelper()`, run from a GM's chat macro, prompts for the skill, the DC and the adjustment. It then posts a roll button for the selected tokens, with the DC in `[gm]` tags.

### Inventory tools (effects on Use, selling, investiture, handwraps, Bulk)

`rollhandlers/inventory-tools.js`:

- Effects on Use: `useInventoryItem` adds Apply buttons (`getEffectMacrosFor`) for `getItemUseEffects(item)`. Those are the item's own `data.useEffects` (the "Effects on Use" multiselect on the Rules tab) plus every effects `<record-link>` in its description, which is how the modules link "Effect: Bestial Mutagen (Lesser)".
- Selling: `sellInventoryItem(itemDataPath)` is the row's coin button and the grid's Sell action.
  - Both are hidden, and `sellInventoryItem` does nothing, unless the campaign setting "Allow Selling from the Sheet" (`sellFromSheet`, default No) is Yes. `setItemFields` sets `fields.sellBtn.hidden`, and the Inventory tab's onload (`onInventoryLoad`, `getSellButtonValues`) brings every row in line after the setting changes.
  - An item sells for half its Price per unit (the Price is per bundle, `getItemBundleSize`). Treasure sells for its full Price. The total is rounded down, not each unit (`getSellTotalCp`): 10 arrows sell for 5 cp.
  - Shoddy, temporary and infused items get a note in the confirm, not a block.
  - It reads the record again, writes the coins and count in one `setValues`, then removes a sold-out row by its id (`removeValueFromRecord`) and recalculates.
- Investiture: `data.investedCount` is set in the recalc (`getInvestedCount`). It counts items with the invested trait, and armor with runes, that are invested. Investing an 11th (`getInvestmentWarning`) or using an uninvested item that needs it (`getUninvestedUseWarning`) shows a notification. Nothing is blocked.
- Handwraps of mighty blows: an item named so, or with `data.handwraps` ticked, worn (`carried: equipped`) and invested, lends its potency, striking and property runes to every other unarmed attack.
  - `withHandwrapsRunes` is applied first in `getAlteredWeapon`.
  - `getEffectsAndModifiersForToken` also lets the handwraps' item-only modifiers (their property runes' features) apply when `itemId` is an unarmed attack (`getHandwrapsItemIdFor`).
  - The handwraps' own attack is left as it is, and NPCs are skipped.
- Bulk: `data.bulk` is "encumbered above" (5 + Str + `bulkLimit`), and `data.maxBulk` is 10 + Str + `bulkLimit`.
  - `updateTotalBulk` drops fractions (`dropBulkFractions`: 12 light items are 1 Bulk).
  - Crossing a limit posts a chat card (`getEncumbranceMessage`), with an Apply_Encumbered button when the character becomes encumbered. It's posted only for changes the user made: `updateTotalBulk(record, true, true)` (adding, removing, using or selling an item, coins, a count). The tab's onload never posts it.
  - `speedPenalty` (untyped) and `speedPenalty-circumstance`/`-item`/`-status` effect types exist. Foundry's Encumbered is an untyped -10 to all Speeds plus Clumsy 1.

### Healing tools (Treat Wounds and Battle Medicine, persistent damage, rest, regeneration)

`rollhandlers/healing-tools.js`:

- Treat Wounds and Battle Medicine: `treatWounds(kind)` runs both (`battleMedicine()` is `treatWounds("battleMedicine")`, the button on the Battle Medicine feat's card).
  - The metadata's `treatWounds` carries `kind`, `healerId` and `healerName`. The healing adds the module's "Treat Wounds Immunity" (anyone's, 1 hour) or "Battle Medicine Immunity" (that healer's, 1 day) with the healer as applier (`applyMedicineImmunity`). Every result card also has an Apply button for it, safe to click again.
  - A patient already immune gets a warning before the check (`getMedicineImmunityWarning`). Nothing is blocked.
  - Battle Medicine's healing passes `treatWounds: false`, so wounded stays.
  - Several instances of an effect: `effectIds` repeats the id, and `effectValues[id]` becomes an array of `{ value, tokenId, tokenName }` (`getEffectInstances`).
- Persistent damage:
  - `applyPersistentDamage` keeps the higher of one type (`getPersistentStackChange`, by average): a lower or equal one isn't added, and a higher one replaces it (`removeEffectById` with `instanceIndex`).
  - The recovery check: `getPersistentRecoveryOutput` gives the Roll_Recovery button, or rolls it now with the setting "Persistent Damage Recovery" (`persistentRecoveryRoll: auto`), plus an Assisted Recovery button at DC - 5. `flatCheck.js` finds the token by `metadata.tokenId` for an automatic roll.
  - Healing to full Hit Points ends persistent bleed (`applyHealingToToken`, `endPersistentBleed`).
- Rest: `rest()` asks first (`showRestOptions`), then runs `restWith(options)`.
  - No shelter halves the healing (minimum 1). Each long-term rest day heals double (`getRestHealingAmount`). Sleeping in armor without the comfort trait wakes the character fatigued (`isRestFatiguing`).
  - The chat line reminds the GM to advance the calendar. `showWatchOrder()` (a GM chat macro) posts the party's watches (GM Core: 8 h x n / (n - 1)).
- Fast healing and regeneration (NPCs, from `hpDetails` or an ability's name, `getSelfHealing`):
  - `onTurnStart` heals once per round (`data.selfHealRound`, in the healing's own write via `applyHealingToToken`'s `extraValues`).
  - Damage of a listed type, after IWR, sets `data.regenerationOff` to "pending". The next turn start makes it the round number, and that turn's end clears it, so regeneration is off until the end of the creature's next turn.
  - With regeneration on, a monster at 0 HP is dying (up to 3) and unconscious, not dead (`getRegenerationZeroHpChanges`).
- Ferocity (an NPC ability named so): a button at 0 HP until wounded 3. `useMonsterFerocity` sets 1 HP and wounded + 1, and removes the Dead or Unconscious the damage added.

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
