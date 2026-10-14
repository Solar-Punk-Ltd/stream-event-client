/**
 * What Connect tells a viewer about an address it will not use, and the steps of a fix that takes more than one
 * sentence: letting this site read from a Bee node, and undoing a refusal of the browser's local network question.
 */

/** The address the picker suggests for a node on this computer, as Swarm Desktop runs it. */
const THIS_COMPUTER_EXAMPLE = 'http://localhost:1633';

const THIS_COMPUTER_HOSTS = 'localhost or 127.0.0.1';

/** Why the picker will not use what a viewer typed, each with what to type instead. */
export const ADDRESS_REFUSED = {
  notHttp: 'The address has to start with http:// or https://.',
  empty: `Enter the address of your Bee node, for example ${THIS_COMPUTER_EXAMPLE}.`,
  notAnAddress: `That is not an address. Enter one such as ${THIS_COMPUTER_EXAMPLE}.`,
  notJustTheOrigin: `Enter only the scheme, host and port, such as ${THIS_COMPUTER_EXAMPLE}.`,
  ipv6Loopback: `This site cannot use the address [::1]. Use localhost or 127.0.0.1 with your node's port instead, such as ${THIS_COMPUTER_EXAMPLE}.`,
  otherLoopbackHost: `A node on this computer has to be named ${THIS_COMPUTER_HOSTS}, because this site allows only those. Use ${THIS_COMPUTER_EXAMPLE} with your node's port.`,
  plainHttp: `A node on another machine has to be reached at its https address, starting with https://. Or run the node on this computer and use ${THIS_COMPUTER_EXAMPLE}.`,
} as const;

/** One step of help: what it is, then the exact text to copy or the thing to do. */
interface HelpStep {
  readonly label: string;
  readonly code?: string;
  readonly text?: string;
}

/** Help shown under a failure, when the fix takes more than one sentence. */
export interface Help {
  readonly intro: string;
  readonly steps: readonly HelpStep[];
  readonly note: string;
}

/**
 * How to let this site read from a Bee node, for the origin the page is served from, which the caller
 * reads from the page at run time. Bee takes `cors-allowed-origins` as a list in its config file, a
 * flag on the command line, or `BEE_CORS_ALLOWED_ORIGINS` in its environment.
 */
export function corsHelp(origin: string): Help {
  return {
    intro:
      "Add this site to the node's cors-allowed-origins setting, then restart the node. If the setting already lists other sites, add this one to the list.",
    steps: [
      { label: "In the node's config file, often bee.yaml:", code: `cors-allowed-origins: ["${origin}"]` },
      { label: 'Or on the command line:', code: `bee start --cors-allowed-origins=${origin}` },
      { label: 'Or as an environment variable:', code: `BEE_CORS_ALLOWED_ORIGINS=${origin}` },
    ],
    note: "Swarm Desktop writes cors-allowed-origins: '*' into its own config.yaml, which allows every site. If your Swarm Desktop node refuses this site, put that line back and restart Swarm Desktop.",
  };
}

/** How to undo a refusal of the browser's local network question, in the browsers that ask it. */
export const LOCAL_NETWORK_HELP: Help = {
  intro:
    'The first time a site reaches a device on your network or a program on this computer, your browser asks whether to allow it. A Block is remembered for this site. To undo it:',
  steps: [
    {
      label: 'Chrome:',
      text: 'Click the icon to the left of the address, open Site settings, and set Local network access to Allow.',
    },
    {
      label: 'Edge:',
      text: 'Open Settings, then Privacy, search, and services, Site permissions, All permissions, Local network access, and allow this site.',
    },
    {
      label: 'Firefox:',
      text: 'Open Settings, then Privacy & Security, Permissions, and allow this site under Local network devices, or under Device apps and services for a node on this computer.',
    },
  ],
  note: 'Then reload this page and try again.',
};
