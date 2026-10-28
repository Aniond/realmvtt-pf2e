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
2. On the Notes tab, set **Animal Companion of** to its master. Its level becomes the master's. Use **Match Master's Level** after the master levels up.
3. When the master takes Mature Animal Companion (or Incredible Companion, Specialized Animal Companion), add the matching feat here: Mature, then Nimble or Savage, then Specialized and one specialization.

## Building

- `source/player-core-types.json` is the companion types from Archives of Nethys (ORC): attacks, attributes, HP, skill, senses, Speeds, special, Support benefit and advanced maneuver.
- `icons.json` maps each record (`<recordType>|<name>`) to an icon from Realm's catalog.
- `node modules/animal-companions/build.js` writes `records.json` (ancestries, class, feats). `tests/test-animal-companion-module.js` builds companions from it and checks them against stat blocks worked by hand from Player Core pg. 206-211. The test fails if `records.json` is out of date.

## License

The game rules and companion statistics are from **Pathfinder Player Core** (Paizo Inc.), used under the ORC License, located at the Library of Congress at TX 9-307-067 and available online at various locations including paizo.com/orclicense, azoralaw.com/orclicense, and others. All warranties are disclaimed as set forth therein.
