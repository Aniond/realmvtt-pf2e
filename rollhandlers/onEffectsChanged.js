// otherSettings.onEffectsChanged: Realm runs this once per effect change on a
// creature (added, stacked, deducted, removed, expired), in the client that
// made the change. `record` is the creature after the change, `data.changes`
// the effects whose count moved. The data.* values returned are saved with the
// change itself.
// Unleash Psyche ends: the stupefied and the wait, as a card with buttons (the
// hook can't add effects to this creature itself; class-extras.js)
const psycheMessage = getPsycheSubsidesMessage(record, data.changes);
if (psycheMessage) api.sendMessage(psycheMessage, undefined, [], []);

return getDrainedHitPointUpdates(record, data.changes);
