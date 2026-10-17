/**
 * Which secrets appear in which texts, as `<secret name> in <text name>`, never the secret itself. A secret is hex, and
 * is looked for in hex, with or without `0x`, in any case, and in base64, the two ways a page would carry its bytes.
 */
export function findLeaks(texts: Record<string, string>, secrets: Record<string, string>): string[] {
  const forms = Object.entries(secrets).map(([name, secret]) => {
    const hex = secret.replace(/^0x/i, '').toLowerCase();
    if (!hex) throw new Error(`the secret ${name} is empty, and every text would contain it`);
    return { name, hex, base64: Buffer.from(hex, 'hex').toString('base64') };
  });
  const found: string[] = [];
  for (const { name, hex, base64 } of forms) {
    for (const [where, text] of Object.entries(texts)) {
      if (text.toLowerCase().includes(hex) || text.includes(base64)) found.push(`${name} in ${where}`);
    }
  }
  return found;
}

/**
 * The controls a search for keys needs before its silence means anything: the recorded network must hold the drive's
 * batch id, which is public and rides on every message sent with the drive, and at least one trace must hold text. One
 * line for each that fails, none when the search looked at something.
 */
export function searchProblems(har: string, traces: Record<string, string>, batch: string): string[] {
  const problems: string[] = [];
  if (!findLeaks({ har }, { batch }).length) {
    problems.push('the recorded network does not hold the drive’s batch id, so its silence about keys proves nothing');
  }
  if (!Object.values(traces).some((text) => text.length > 0)) {
    problems.push('no trace holds any text, so the traces were not searched');
  }
  return problems;
}
