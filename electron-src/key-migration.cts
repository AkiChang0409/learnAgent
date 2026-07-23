async function loadSafeSnapshot(storage, secretStore) {
  let snapshot = await storage.loadSnapshot();
  const legacyKey = String(snapshot.data?.settings?.apiKey || '').trim();
  if (legacyKey) {
    await secretStore.setApiKey(legacyKey);
    try {
      const accepted = await storage.applyChanges({
        baseRevision: snapshot.revision,
        changes: { settings: { apiKeyConfigured: true } }
      });
      await storage.flushData();
      snapshot = { data: await storage.loadData(), revision: accepted.revision };
    } catch (error) {
      // React Strict Mode can request the initial snapshot twice. If both calls
      // migrate the same legacy key, the first one advances the revision and the
      // second one must use that already-migrated snapshot instead of failing.
      if (error?.code !== 'REVISION_CONFLICT') throw error;
      snapshot = await storage.loadSnapshot();
    }
  }
  const configured = await secretStore.isConfigured();
  const { apiKey: _legacyApiKey, ...safeSettings } = snapshot.data.settings || {};
  return {
    revision: snapshot.revision,
    data: { ...snapshot.data, settings: { ...safeSettings, apiKeyConfigured: configured } }
  };
}

module.exports = { loadSafeSnapshot };
