const HEX = /^(0x)?([0-9a-f]{2})+$/i;

/** How a key is looked for: its hex in any case, and the base64 of its bytes. */
const keyForms = (secret: string) => {
  const hex = secret.replace(/^0x/i, '').toLowerCase();
  return { lowered: [hex], exact: [Buffer.from(hex, 'hex').toString('base64')] };
};

/**
 * How a typed secret, a phrase or a password, is looked for: as typed, as JSON writes it, as an address encodes it with
 * `%20` or `+` for a space, and as the base64 of its UTF-8.
 */
const textForms = (secret: string) => ({
  lowered: [],
  exact: [
    ...new Set([
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(secret),
      encodeURIComponent(secret).replaceAll('%20', '+'),
      Buffer.from(secret, 'utf8').toString('base64'),
    ]),
  ],
});

/**
 * Which secrets appear in which texts, as `<secret name> in <text name>`, never the secret itself. A key, written in
 * hex, is looked for in hex, with or without `0x`, in any case, and in base64, the two ways a page would carry its
 * bytes. Any other secret is text a person types, and is looked for as typed and in the encodings a page or a request
 * would carry it in.
 */
export function findLeaks(texts: Record<string, string>, secrets: Record<string, string>): string[] {
  const forms = Object.entries(secrets).map(([name, secret]) => {
    if (!secret.replace(/^0x/i, '')) throw new Error(`the secret ${name} is empty, and every text would contain it`);
    return { name, ...(HEX.test(secret) ? keyForms(secret) : textForms(secret)) };
  });
  const found: string[] = [];
  for (const { name, lowered, exact } of forms) {
    for (const [where, text] of Object.entries(texts)) {
      const lower = text.toLowerCase();
      if (lowered.some((form) => lower.includes(form)) || exact.some((form) => text.includes(form))) {
        found.push(`${name} in ${where}`);
      }
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
