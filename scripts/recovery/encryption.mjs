import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, link, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
const MAGIC = Buffer.from("LifeOSBackupV1\n");
const parameters = { N: 131072, r: 8, p: 1 };
function keyFor(passphrase, salt) {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 32 ||
    passphrase.length > 4096
  )
    throw Error("Backup passphrase must contain at least 32 characters");
  return scryptSync(passphrase, salt, 32, {
    ...parameters,
    maxmem: 256 * 1024 * 1024,
  });
}
export async function checksumFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function encryptBackup(input, output, passphrase) {
  const salt = randomBytes(32),
    iv = randomBytes(12);
  const key = keyFor(passphrase, salt);
  const header = Buffer.from(
    JSON.stringify({
      version: 1,
      cipher: "aes-256-gcm",
      kdf: "scrypt",
      ...parameters,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
    }) + "\n",
  );
  const aad = Buffer.concat([MAGIC, header]),
    partial = output + ".partial";
  try {
    await writeFile(partial, aad, { mode: 0o600, flag: "wx" });
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    await pipeline(
      createReadStream(input),
      cipher,
      createWriteStream(partial, { flags: "a", mode: 0o600 }),
    );
    await appendFile(partial, cipher.getAuthTag());
    await link(partial, output);
    await rm(partial);
    return {
      sha256: await checksumFile(output),
      bytes: (await stat(output)).size,
    };
  } catch {
    await rm(partial, { force: true });
    throw Error("Backup encryption failed");
  } finally {
    key.fill(0);
  }
}
export async function decryptBackup(input, output, passphrase) {
  const handle = await open(input, "r");
  let aad, header, start, size;
  try {
    size = (await handle.stat()).size;
    if (size > 1024 * 1024 * 1024 || size < MAGIC.length + 32)
      throw Error("Invalid encrypted backup size");
    const prefix = Buffer.alloc(Math.min(size, 4096));
    await handle.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC))
      throw Error("Unknown backup format");
    const newline = prefix.indexOf(10, MAGIC.length);
    if (newline < 0) throw Error("Invalid backup header");
    aad = prefix.subarray(0, newline + 1);
    header = JSON.parse(
      prefix.subarray(MAGIC.length, newline).toString("utf8"),
    );
    start = newline + 1;
    if (
      header.version !== 1 ||
      header.cipher !== "aes-256-gcm" ||
      header.kdf !== "scrypt" ||
      header.N !== parameters.N ||
      header.r !== parameters.r ||
      header.p !== parameters.p ||
      Buffer.from(header.salt ?? "", "base64").length !== 32 ||
      Buffer.from(header.iv ?? "", "base64").length !== 12 ||
      size <= start + 16
    )
      throw Error("Unsupported or malformed backup envelope");
  } finally {
    await handle.close();
  }
  const key = keyFor(passphrase, Buffer.from(header.salt, "base64")),
    partial = output + ".partial";
  try {
    const tagHandle = await open(input, "r");
    const tag = Buffer.alloc(16);
    try {
      await tagHandle.read(tag, 0, 16, size - 16);
    } finally {
      await tagHandle.close();
    }
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(header.iv, "base64"),
    );
    cipher.setAAD(aad);
    cipher.setAuthTag(tag);
    await pipeline(
      createReadStream(input, { start, end: size - 17 }),
      cipher,
      createWriteStream(partial, { flags: "wx", mode: 0o600 }),
    );
    await link(partial, output);
    await rm(partial);
    return { bytes: (await stat(output)).size };
  } catch {
    await rm(partial, { force: true });
    throw Error("Backup authentication or decryption failed");
  } finally {
    key.fill(0);
  }
}
