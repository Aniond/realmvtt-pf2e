// otherSettings.onEffectsChanged: Realm runs this once per effect change on a
// creature (added, stacked, deducted, removed, expired), in the client that
// made the change. `record` is the creature after the change, `data.changes`
// the effects whose count moved. The data.* values returned are saved with the
// change itself.
return getDrainedHitPointUpdates(record, data.changes);
