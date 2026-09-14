export const PLUGIN_ID = "vault-cloak";
export const PLUGIN_NAME = "Vault Cloak";
export const LEGACY_PLUGIN_ID = "obsidian-encrypt";
export const FORMAT_VERSION = 1;
export const HEADER_PREFIX = "%%vault-cloak:";

export interface Envelope {
  version: number;
  keyId: string;
  payload: string;
}

export interface EncryptSettings {
  currentKeyId: string;
  keys: Record<string, string>;
  armed: boolean;
  fileRecoveryAcknowledged: boolean;
}

export const DEFAULT_SETTINGS: EncryptSettings = {
  currentKeyId: "",
  keys: {},
  armed: true,
  fileRecoveryAcknowledged: false,
};
