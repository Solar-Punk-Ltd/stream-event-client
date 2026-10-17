/**
 * Forged and replayed chat messages, built in the kit's own process and written raw to the chat's GSOC inbox, so the
 * server's checks are attacked the way a hostile client would. Nothing here goes through the viewer or Swarm ID: it
 * signs bytes and hands them to Bee. The message formats are the chat library's own constants, so a change there shows
 * up as a build error rather than as a forgery the server quietly accepts.
 */
import { PrivateKey } from '@ethersphere/bee-js';
import {
  CHAT_BINDING_TITLE,
  encodeChatMessage,
  MessageType,
  MessageVia,
  MESSAGE_VERSION,
  newMessageId,
  signedBytes,
  WALLET_LINK_STATEMENT,
  WALLET_LINK_TITLE,
} from '@solarpunkltd/swarm-chat-js/message';
import { type Hex, keccak256 } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';

/** secp256k1's group order, for turning a canonical low-s signature into its refused high-s twin. */
const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const bare = (address: string): string => address.toLowerCase().replace(/^0x/, '');

/** The chat message fields the library signs over, in its order, with `addr` left open so a forgery can mis-set it. */
interface MessageFields {
  v: number;
  topic: string;
  id: string;
  type: string;
  target: string;
  text: string;
  name: string;
  addr: string;
  ts: number;
  via: string;
  idb?: { msg: string; sig: string };
  wl?: { msg: string; wsig: string; asig: string };
}

function fields(topic: string, text: string, addr: string, extra: Partial<MessageFields> = {}): MessageFields {
  return {
    v: MESSAGE_VERSION,
    topic,
    id: newMessageId(),
    type: MessageType.TEXT,
    target: '',
    text,
    name: 'evil',
    addr,
    ts: Date.now(),
    via: MessageVia.GATEWAY,
    ...extra,
  };
}

function sealed(key: PrivateKey, body: MessageFields): Uint8Array {
  const sig = key.sign(signedBytes(body as never)).toHex();
  return encodeChatMessage({ ...body, sig } as never);
}

/** A well-formed guest message, signed by `key` and naming its own address, as a plain sender sends it. */
export function guestMessage(key: PrivateKey, topic: string, text: string): Uint8Array {
  return sealed(key, fields(topic, text, key.publicKey().address().toHex()));
}

/** A message that claims an address its signature was not made by, which the server must drop as a bad signature. */
export function wrongAddressMessage(key: PrivateKey, topic: string, text: string, claimedAddr: string): Uint8Array {
  return sealed(key, fields(topic, text, bare(claimedAddr)));
}

/** A validly signed message whose text is then changed, so the signature no longer covers the bytes that arrive. */
export function tamperedMessage(key: PrivateKey, topic: string, text: string): Uint8Array {
  const body = fields(topic, text, key.publicKey().address().toHex());
  const sig = key.sign(signedBytes(body as never)).toHex();
  return encodeChatMessage({ ...body, text: `${text} tampered`, sig } as never);
}

/** The four lines of a Swarm ID chat binding, as the fork writes and the chat library reads them. */
function chatBindingMessage(site: string, chatAddress: string, date: Date): string {
  return [
    CHAT_BINDING_TITLE,
    `Site: ${site}`,
    `Chat address: 0x${bare(chatAddress)}`,
    `Date: ${date.toISOString()}`,
  ].join('\n');
}

/** The five lines of a Swarm ID wallet link. */
function walletLinkMessage(account: string, wallet: string, date: Date): string {
  return [
    WALLET_LINK_TITLE,
    WALLET_LINK_STATEMENT,
    `Account: 0x${bare(account)}`,
    `Wallet: 0x${bare(wallet)}`,
    `Date: ${date.toISOString()}`,
  ].join('\n');
}

/** EIP-191: keccak256 over the prefix, the byte length and the message. */
function personalHash(message: string): Hex {
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  return keccak256(new Uint8Array([...prefix, ...body]));
}

const vByte = (v: number): string => (v === 0 ? 27 : v === 1 ? 28 : v).toString(16).padStart(2, '0');

/** An EIP-191 personal_sign in the canonical 65-byte form, v 27 or 28 with low s, which the fork accepts. */
export async function personalSign(key: Hex, message: string): Promise<string> {
  const { r, s, v } = await sign({ hash: personalHash(message), privateKey: key });
  return `0x${r.slice(2)}${s.slice(2)}${vByte(Number(v))}`;
}

/** The same signature re-spelled with the high half of s, which every reader refuses as non-canonical. */
async function personalSignHighS(key: Hex, message: string): Promise<string> {
  const low = await personalSign(key, message);
  const highS = (CURVE_ORDER - BigInt(`0x${low.slice(66, 130)}`)).toString(16).padStart(64, '0');
  const flipped = parseInt(low.slice(130, 132), 16) === 27 ? 28 : 27;
  return `0x${low.slice(2, 66)}${highS}${flipped.toString(16).padStart(2, '0')}`;
}

/**
 * A message with a valid binding for `site`, signed by its own chat key, as a hostile sender on `site` would send. The
 * reader and the server accept the binding itself, which is how the forged wallet link below is the one thing that
 * fails.
 */
export async function boundMessage(opts: {
  topic: string;
  text: string;
  site: string;
  accountKey: Hex;
  chatKey: Hex;
  date?: Date;
}): Promise<Uint8Array> {
  const date = opts.date ?? new Date();
  const chat = new PrivateKey(opts.chatKey.slice(2));
  const msg = chatBindingMessage(opts.site, chat.publicKey().address().toHex(), date);
  const idb = { msg, sig: await personalSign(opts.accountKey, msg) };
  return sealed(chat, fields(opts.topic, opts.text, chat.publicKey().address().toHex(), { idb }));
}

/**
 * A message whose binding names a site other than the server's, which the server must drop: a binding is for one site
 * and proves nothing in another's chat.
 */
export async function foreignBindingMessage(opts: {
  topic: string;
  text: string;
  otherSite: string;
  accountKey: Hex;
  chatKey: Hex;
  date?: Date;
}): Promise<Uint8Array> {
  return boundMessage({ ...opts, site: opts.otherSite });
}

/** How a forged wallet link is made wrong, each of which a reader and the server must refuse. */
export type WalletLinkFlaw = 'high-s' | 'wrong-wallet' | 'another-account';

/**
 * A message with a valid binding for `site` and a wallet link that is wrong in one of three ways: the wallet signature
 * is non-canonical, it is some other wallet's, or the link names an account other than the binding's. The server must
 * drop each as a binding failure, so no ENS name is ever shown for it.
 */
export async function forgedWalletLinkMessage(opts: {
  topic: string;
  text: string;
  site: string;
  accountKey: Hex;
  chatKey: Hex;
  wallet: Hex;
  otherWallet: Hex;
  flaw: WalletLinkFlaw;
  date?: Date;
}): Promise<Uint8Array> {
  const date = opts.date ?? new Date();
  const chat = new PrivateKey(opts.chatKey.slice(2));
  const account = privateKeyToAccount(opts.accountKey);
  const bindingMsg = chatBindingMessage(opts.site, chat.publicKey().address().toHex(), date);
  const idb = { msg: bindingMsg, sig: await personalSign(opts.accountKey, bindingMsg) };

  const linkAccount = opts.flaw === 'another-account' ? privateKeyToAccount(opts.otherWallet).address : account.address;
  const linkWallet = privateKeyToAccount(opts.wallet).address;
  const msg = walletLinkMessage(linkAccount, linkWallet, date);
  const wsig =
    opts.flaw === 'high-s'
      ? await personalSignHighS(opts.wallet, msg)
      : opts.flaw === 'wrong-wallet'
        ? await personalSign(opts.otherWallet, msg)
        : await personalSign(opts.wallet, msg);
  const asig = await personalSign(opts.accountKey, msg);
  return sealed(
    chat,
    fields(opts.topic, opts.text, chat.publicKey().address().toHex(), { idb, wl: { msg, wsig, asig } }),
  );
}
