async function loadSafeSnapshot(storage, secretStore) {
  let snapshot = await storage.loadSnapshot();
  const legacyKey = String(snapshot.data?.settings?.apiKey || '').trim();
  if (legacyKey) {
    await secretStore.setApiKey(legacyKey);
    const accepted = await storage.applyChanges({
      baseRevision: snapshot.revision,
      changes: { settings: { apiKeyConfigured: true } }
    });
    await storage.flushData();
    snapshot = { data: await storage.loadData(), revision: accepted.revision };
  }
  const configured = await secretStore.isConfigured();
  const { apiKey: _legacyApiKey, ...safeSettings } = snapshot.data.settings || {};
  return {
    revision: snapshot.revision,
    data: { ...snapshot.data, settings: { ...safeSettings, apiKeyConfigured: configured } }
  };
}

module.exports = { loadSafeSnapshot };
