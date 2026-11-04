// RFC 4122 v4 UUID generation for the browser-side schedule factory.
// crypto.randomUUID is available in every browser the SPA targets and in the
// jsdom test environment; the Math.random fallback keeps old WebViews working.

export function uuidv4(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
