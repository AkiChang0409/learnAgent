const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

function createSecretStore(userDataPath) {
  const secretPath = path.join(userDataPath, 'ai-key.safe');

  async function setApiKey(value) {
    const key = String(value || '').trim();
    if (!key) return clearApiKey();
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用');
    const encrypted = safeStorage.encryptString(key);
    const tempPath = `${secretPath}.tmp`;
    const previousPath = `${secretPath}.previous`;
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(encrypted);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.unlink(previousPath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    await fs.rename(secretPath, previousPath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    try {
      await fs.rename(tempPath, secretPath);
      await fs.unlink(previousPath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    } catch (error) {
      await fs.rename(previousPath, secretPath).catch(() => {});
      throw error;
    }
    return { configured: true };
  }

  async function getApiKey() {
    try {
      const encrypted = await fs.readFile(secretPath);
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用');
      return safeStorage.decryptString(encrypted);
    } catch (error) {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }
  }

  async function clearApiKey() {
    for (const candidate of [secretPath, `${secretPath}.tmp`, `${secretPath}.previous`]) {
      await fs.unlink(candidate).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    }
    return { configured: false };
  }

  async function isConfigured() {
    return Boolean(await getApiKey());
  }

  return { setApiKey, getApiKey, clearApiKey, isConfigured };
}

module.exports = { createSecretStore };
