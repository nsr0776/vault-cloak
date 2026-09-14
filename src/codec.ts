import { FORMAT_VERSION, HEADER_PREFIX, type Envelope } from "./types";

const HEADER_RE =
  /^%%(?:vault-cloak|obsidian-encrypt):(\d+):([A-Za-z0-9_-]+)%%(?:\r?\n|$)/;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const B64_CHUNK = 0x2000;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseEnvelope(text: string): Envelope | null {
  const src = stripBom(text);
  const match = HEADER_RE.exec(src);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return {
    version: Number(match[1]),
    keyId: match[2],
    payload: src.slice(match[0].length).replace(/\s+/g, ""),
  };
}

export function isEnvelope(text: string): boolean {
  return parseEnvelope(text) !== null;
}

export function wrapEnvelope(keyId: string, payloadB64: string): string {
  return `${HEADER_PREFIX}${FORMAT_VERSION}:${keyId}%%\n${payloadB64}\n`;
}

export function nextKeyId(keys: Record<string, string>): string {
  let max = 0;
  for (const id of Object.keys(keys)) {
    const match = /^k(\d+)$/.exec(id);
    if (!match || match[1] === undefined) {
      continue;
    }
    const n = Number(match[1]);
    if (n > max) {
      max = n;
    }
  }
  return `k${max + 1}`;
}

export function randomKeyBytes(): Uint8Array {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    const slice = bytes.subarray(i, i + B64_CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function importAesKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, [usage]);
}

export async function encryptString(plaintext: string, rawKey: Uint8Array): Promise<string> {
  const key = await importAesKey(rawKey, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(encoded)),
  );
  const packed = new Uint8Array(iv.byteLength + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(cipher, iv.byteLength);
  return bytesToB64(packed);
}

export async function decryptString(payloadB64: string, rawKey: Uint8Array): Promise<string> {
  const packed = b64ToBytes(payloadB64);
  if (packed.byteLength <= IV_BYTES) {
    throw new Error("Ciphertext is too short");
  }
  const iv = packed.subarray(0, IV_BYTES);
  const cipher = packed.subarray(IV_BYTES);
  const key = await importAesKey(rawKey, "decrypt");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(cipher),
  );
  return new TextDecoder("utf-8").decode(plain);
}

export async function sealText(
  plaintext: string,
  keyId: string,
  rawKey: Uint8Array,
): Promise<string> {
  if (isEnvelope(plaintext)) {
    return plaintext;
  }
  const payload = await encryptString(plaintext, rawKey);
  return wrapEnvelope(keyId, payload);
}

export async function revealText(
  data: string,
  keys: Record<string, string>,
): Promise<{ text: string; enveloped: boolean; keyId?: string }> {
  const envelope = parseEnvelope(data);
  if (!envelope) {
    return { text: data, enveloped: false };
  }
  if (envelope.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported envelope version ${envelope.version}`);
  }
  const keyB64 = keys[envelope.keyId];
  if (!keyB64) {
    throw new Error(`Missing encryption key ${envelope.keyId}`);
  }
  const text = await decryptString(envelope.payload, b64ToBytes(keyB64));
  return { text, enveloped: true, keyId: envelope.keyId };
}
