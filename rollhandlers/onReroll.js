const { roll, record } = data;
const metadata = roll?.metadata;
const recordId = metadata?.recordId;
const recordType = metadata?.recordType;

if (recordType && recordId) {
  // Check if we have hero points
  const heroPoints = record.data?.heroPoints || 0;
  if (heroPoints > 0) {
    api.setValuesOnRecord(record, { "data.heroPoints": heroPoints - 1 });
    return {
      success: true,
    };
  } else {
    api.showNotification(
      "You do not have any hero points.",
      "red",
      "No Hero Points"
    );
    return {
      success: false,
    };
  }
} else {
  return {
    success: true,
  };
}
