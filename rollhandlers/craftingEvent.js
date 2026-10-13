// Crafting Downtime Events (Treasure Vault pg. 160): posts the event for the d20 roll
const event = getCraftingDowntimeEvent(data?.roll?.total);

if (event) {
  api.sendMessage(
    `**Crafting Downtime Event**\n\n**${event.name}.** ${event.summary}\n\n*Treasure Vault (Remastered) pg. 160*`,
    data.roll,
    [],
    [{ name: "Crafting", tooltip: "Crafting Downtime Event" }],
  );
}
