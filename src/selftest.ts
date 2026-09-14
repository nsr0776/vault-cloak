import assert from "node:assert/strict";
import {
  b64ToBytes,
  bytesToB64,
  decryptString,
  encryptString,
  isEnvelope,
  nextKeyId,
  parseEnvelope,
  randomKeyBytes,
  revealText,
  sealText,
} from "./codec";
import { isCloakPath } from "./scope";

async function main(): Promise<void> {
  assert.equal(isCloakPath("Welcome.md"), true);
  assert.equal(isCloakPath("folder/Note.MD"), true);
  assert.equal(isCloakPath(".obsidian/app.json"), false);
  assert.equal(isCloakPath(".obsidian/themes/Border/theme.css"), false);
  assert.equal(isCloakPath(".trash/Welcome.md"), false);
  assert.equal(isCloakPath(".git/HEAD"), false);
  assert.equal(isCloakPath("image.png"), false);

  assert.equal(isEnvelope("# hello"), false);
  assert.equal(parseEnvelope("# hello"), null);

  const key = randomKeyBytes();
  const sealed = await sealText("hello from OSEP", "k1", key);
  assert.equal(isEnvelope(sealed), true);
  const envelope = parseEnvelope(sealed);
  assert.ok(envelope);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.keyId, "k1");

  const revealed = await revealText(sealed, { k1: bytesToB64(key) });
  assert.equal(revealed.text, "hello from OSEP");
  assert.equal(revealed.enveloped, true);

  const crlf = sealed.replace("\n", "\r\n");
  const fromCrlf = await revealText(crlf, { k1: bytesToB64(key) });
  assert.equal(fromCrlf.text, "hello from OSEP");

  const withBom = `\uFEFF${sealed}`;
  const fromBom = await revealText(withBom, { k1: bytesToB64(key) });
  assert.equal(fromBom.text, "hello from OSEP");

  assert.equal(sealed.startsWith("%%vault-cloak:1:k1%%"), true);

  const legacyHeader = sealed.replace("%%vault-cloak:", "%%obsidian-encrypt:");
  const fromLegacy = await revealText(legacyHeader, { k1: bytesToB64(key) });
  assert.equal(fromLegacy.text, "hello from OSEP");

  const twice = await sealText(sealed, "k1", key);
  assert.equal(twice, sealed);

  await assert.rejects(() => revealText(sealed, { k2: bytesToB64(randomKeyBytes()) }));

  const other = randomKeyBytes();
  await assert.rejects(() => decryptString(envelope.payload, other));

  const k1 = randomKeyBytes();
  const k2 = randomKeyBytes();
  const underK1 = await sealText("payload", "k1", k1);
  const rotatedPlain = await revealText(underK1, {
    k1: bytesToB64(k1),
    k2: bytesToB64(k2),
  });
  const underK2 = await sealText(rotatedPlain.text, "k2", k2);
  const env2 = parseEnvelope(underK2);
  assert.equal(env2?.keyId, "k2");
  const afterRotate = await revealText(underK2, {
    k1: bytesToB64(k1),
    k2: bytesToB64(k2),
  });
  assert.equal(afterRotate.text, "payload");

  assert.equal(nextKeyId({}), "k1");
  assert.equal(nextKeyId({ k1: "x", k3: "y" }), "k4");

  const roundtrip = await decryptString(await encryptString("abc", key), key);
  assert.equal(roundtrip, "abc");

  const packed = b64ToBytes(bytesToB64(key));
  assert.deepEqual(Array.from(packed), Array.from(key));

  console.log("selftest ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
