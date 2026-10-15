import type { SwarmIdWalletLink } from '../../src/features/chat/swarmId/swarmIdClient';

/**
 * Wallet links made by the Swarm ID fork for its test account, as swarm-chat-js 8.2 keeps them in
 * `test/walletLinkVectors.ts`, spelled the way the Swarm ID library hands them over. The wallet's key holds nothing.
 */
export const LINK_WALLET = '0x5cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb';

/** For the fork's test account, the one `CHAT_BINDING` names. */
export const FORK_WALLET_LINK: SwarmIdWalletLink = {
  message:
    'Swarm ID wallet link v1\nI link this wallet to the Swarm ID account below, so sites may show my ENS name beside its messages.\nAccount: 0x1563915e194d8cfba1943570603f7606a3115508\nWallet: 0x5cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb\nDate: 2026-10-15T12:01:00.000Z',
  walletSignature:
    '0x8375ed13f2afa0b70f62f94f82012f52022028620fbdc90ea073990a1fbb23e03aa67b6d49b84651f4b1096c9106d25a971407dc02d3663ec1a1a65500a520ae1c',
  accountSignature:
    '0x8b253d455123dfb0a00c4ad56e0e65fffbb99850efcbe3fea85e2583034b3d8605e83f895c80e29eda6ff9ef481f3ad9090fad20d37508a6b29462ad9e2562891b',
};

/** The same wallet linked to another account, a valid link that is not the fork's test account's. */
export const OTHER_ACCOUNT_WALLET_LINK: SwarmIdWalletLink = {
  message:
    'Swarm ID wallet link v1\nI link this wallet to the Swarm ID account below, so sites may show my ENS name beside its messages.\nAccount: 0x7564105e977516c53be337314c7e53838967bdac\nWallet: 0x5cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb\nDate: 2026-10-15T12:00:00.000Z',
  walletSignature:
    '0x630a8fb5315c0bd61bf7699390c981681c5b2a5754c015c28e5fc76d7f1c38d30041e06fa1567c9f730fc9864446385e1e023c1b3a2433f38bd4c14266aba6071b',
  accountSignature:
    '0xdeec1f70d884d3906ad38cb8bdae39ef14603c0087433a556a80829ac76a82d50d9a6abcef8695a3a3238362e8526899985adf5debb3e2f0666762726d56db541b',
};

/** {@link FORK_WALLET_LINK} in the chat library's spelling, as a message carries it. */
export const FORK_CHAT_WALLET_LINK = {
  msg: FORK_WALLET_LINK.message,
  wsig: FORK_WALLET_LINK.walletSignature,
  asig: FORK_WALLET_LINK.accountSignature,
};
