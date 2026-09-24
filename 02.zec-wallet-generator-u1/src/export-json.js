import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function timestampForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Saves a generated wallet batch to a timestamped JSON file.
 * The file contains mnemonic phrases and private keys, so it must remain secret.
 */
export async function exportWalletsToJson(
  wallets,
  { outputDir = path.join(PROJECT_ROOT, "output"), now = new Date() } = {}
) {
  if (!Array.isArray(wallets) || wallets.length === 0) {
    throw new Error("wallets must be a non-empty array");
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("now must be a valid Date");
  }

  const generatedAt = now.toISOString();
  const filename = `wallets-${timestampForFilename(now)}.json`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, filename);

  const data = {
    generatedAt,
    walletCount: wallets.length,
    mnemonicWords: wallets[0]?.words ?? null,
    wallets: wallets.map((wallet) => ({
      ...wallet,
      index: wallet.index + 1
    }))
  };

  await mkdir(absoluteOutputDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  return filePath;
}
