# Animal Companions module

Animal companions for the PF2e ruleset as **characters**, the way Foundry's [PF2e Companion Compendia](https://github.com/TikaelSol/PF2e-Animal-Companions) builds them (roadmap H14):

- **Ancestry = companion type.** Player Core's 16: ape, arboreal sapling, badger, bat, bear, bird, boar, cat, crocodile, dromaeosaur, horse, riding drake, scorpion, shark, snake, wolf. Each has its HP, size, Speed and vision. One ancestry feature carries:
  - its attribute modifiers
  - its trained skill (expert once mature; master with a specialization that raises it)
  - its senses and other Speeds
  - its natural attacks, as unarmed weapons
  - its Support action
  - its advanced maneuver, which appears once it's nimble or savage
- **Class = Animal Companion.** 6 HP per level. Trained in Perception, all saves, unarmed attacks, unarmored defense, barding (light and heavy), Acrobatics and Athletics. No feats, boosts or skill increases. The ruleset gives it no Automatic Bonus Progression, only item bonuses to AC and Speed, and at most +3 AC from barding (`rollhandlers/animal-companions.js`).
- **Feats** for the companion itself: Mature, Nimble, Savage and Specialized Animal Companion, and the six specializations (Ambusher, Bully, Daredevil, Racer, Tracker, Wrecker). Add one when the master takes the matching feat.

## Making a companion

1. Create a character, drop a companion ancestry (e.g. Bear) and the Animal Companion class on it. Don't use the creation wizard.
2. On the Notes tab, set **Animal Companion of** to its master. Its level becomes the master's. Use **Match Master's Level** after the master levels up. To give it a creature's art, pick one under **Use art from creature**.
3. When the master takes Mature Animal Companion (or Incredible Companion, Specialized Animal Companion), add the matching feat here: Mature, then Nimble or Savage, then Specialized and one specialization.

## Rules notes

- **Specialization skills:** "expert (or master if it was already expert from its type)" is read literally. Ambusher, Bully and Tracker make the type's own skill master. A skill that's expert from Savage or Nimble stays expert (a savage Bully's Athletics). Foundry raises those to master too.
- **Barding:** the class is trained in light and heavy armor, because barding is light or heavy armor in Realm's data. So the companion also counts as trained in ordinary light and heavy armor. Its item bonus to AC is capped at +3 either way.
- **Racer:** turn on one of Racer's toggles (Land, Swim or Fly Speed) to choose which Speed gets the +10 feet.
- **No Automatic Bonus Progression** for companions is Foundry's convention (its class sets `disableABP`), not a printed rule.

## Building

- `source/player-core-types.json` is the companion types from Archives of Nethys (ORC): attacks, attributes, HP, skill, senses, Speeds, special, Support benefit and advanced maneuver.
- `icons.json` maps each record (`<recordType>|<name>`) to an icon from Realm's catalog.
- `node modules/animal-companions/build.js` writes `records.json` (ancestries, class, feats). `tests/test-animal-companion-module.js` builds companions from it and checks them against stat blocks worked by hand from Player Core pg. 206-211. The test fails if `records.json` is out of date.

## Creature art

**On a table's own sheet:** a companion's Notes tab has a **Use art from creature** picker. Choose any NPC in your campaign (e.g. Monster Core's Grizzly Bear), and the companion takes that creature's portrait and token. Tables that own books with creature art can use it this way, while the module itself ships none.

### Adding creature art to the module (once you hold a license for it)

The module ships with catalog icons only. Realm's Monster Core NPCs have real art for most of these animals (the Grizzly Bear's portrait and token, for example), but that art is Paizo's and isn't covered by the ORC License. To use it you need your own license for it; it can't go in a shared module otherwise.

With a license:

1. **Find the art.** For each companion type, pick the matching Monster Core NPC (Bear → Grizzly Bear, Wolf → Wolf, Horse → Riding Horse...). Its record has the two paths you need: `portrait` (`/images/…_bear-grizzly.webp`) and `token.imageUrl` (its round token, also `/images/…`).
2. **Add `art.json`** next to `build.js`, mapping a companion type to its two pictures:

   ```json
   {
     "Bear": {
       "portrait": "/images/6f864ba6-2eef-4ee1-9e6a-357bee44cb40_bear-grizzly.webp",
       "token": "/images/f69c610c-cf6c-4614-b1e5-3dab5804dbf4_bear-grizzly.webp"
     }
   }
   ```

   Types you leave out keep their catalog icon.
3. **Rebuild:** `node modules/animal-companions/build.js`. Each listed ancestry's `portrait` becomes the art, and its `data.tokenImage` the token.
4. **Load or publish** the records as usual.

When a player drops the ancestry on a new companion, the character takes the portrait and the token image (`getCompanionImageValues` in `rollhandlers/animal-companions.js`). A picture the player has already set is never replaced.

To try a single type in a test campaign without rebuilding, set that ancestry's `portrait` and `data.tokenImage` to the NPC's two paths. We tested it that way with the Bear in testst, using artwork David owns.

## License

The game rules and companion statistics are from **Pathfinder Player Core** (Paizo Inc.), used under the ORC License, located at the Library of Congress at TX 9-307-067 and available online at various locations including paizo.com/orclicense, azoralaw.com/orclicense, and others. All warranties are disclaimed as set forth therein.
