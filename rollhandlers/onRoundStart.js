// Keep the encounter's round and the creatures in it where predicates can
// read them during rolls (encounter, encounter:round:<n>): the combat tracker
// itself can only be read with a callback. This also runs when the encounter
// starts, where the round passed can still be 0, so that is round 1.
const round = parseInt(data?.round, 10);
setEncounterState(data?.tokens, round > 0 ? round : 1);
