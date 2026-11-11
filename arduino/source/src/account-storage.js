// Хранилище MicroLab разделяется по подтверждённому сервером ученику.
// Старые общие ключи сохраняем, но не приписываем их случайному следующему посетителю.
export function scopedStorage(native, prefix = '') {
  const keys = () => Array.from({length: native.length}, (_, i) => native.key(i)).filter(k => k !== null && k.startsWith(prefix)).map(k => k.slice(prefix.length));
  return {
    getItem: key => native.getItem(prefix + key),
    setItem: (key, value) => native.setItem(prefix + key, value),
    removeItem: key => native.removeItem(prefix + key),
    key: i => keys()[i] ?? null,
    get length() { return keys().length; },
    clear() { for (const key of keys()) native.removeItem(prefix + key); },
    keys,
    eventKey: key => key === null ? null : key.startsWith(prefix) ? key.slice(prefix.length) : undefined,
  };
}
function accountStorage() {
  const sid = globalThis.EGE_ARDUINO_SID;
  if (globalThis.EGE_ARDUINO_REQUIRE_AUTH && (!Number.isSafeInteger(sid) || sid <= 0)) throw Error('Сначала войдите в Egeshka');
  return scopedStorage(globalThis.localStorage, sid ? `egeshka.arduino.${sid}.` : '');
}
export const accountLocalStorage = {
  getItem: key => accountStorage().getItem(key),
  setItem: (key, value) => accountStorage().setItem(key, value),
  removeItem: key => accountStorage().removeItem(key),
};
export const accountStorageKeys = () => accountStorage().keys();
export const accountStorageEventKey = key => accountStorage().eventKey(key);
