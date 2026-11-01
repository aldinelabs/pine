import type { TinyFishSafeStorage } from "../main/tinyfishCredentials";

/**
 * A server has no desktop keychain to encrypt with, so credentials rely on
 * the data directory's file permissions instead: the store writes them
 * readable by the server's user only, like the provider keys beside them.
 */
export const fileCredentialStorage: TinyFishSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(plainText, "utf8"),
  decryptString: (encrypted) => encrypted.toString("utf8"),
};
