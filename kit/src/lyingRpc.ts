import { encodeFunctionResult, parseAbi, toFunctionSelector } from 'viem';

/**
 * ENS's Universal Resolver reverse lookup, as viem's `getEnsName` calls it. The resolver checks on chain that the
 * primary name's address record names the wallet back, so its one answer is the reverse and the forward record at once.
 */
const reverseAbi = parseAbi([
  'function reverseWithGateways(bytes reverseName, uint256 coinType, string[] gateways) view returns (string resolvedName, address resolver, address reverseResolver)',
]);
const REVERSE_SELECTOR = toFunctionSelector(reverseAbi[0]);
/** Any contract address, since a reader that trusts the answer reads no further than the name. */
const SOME_RESOLVER = '0x000000000000000000000000000000000000dEaD';

interface JsonRpcCall {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown[];
}

const isCall = (value: unknown): value is JsonRpcCall =>
  typeof value === 'object' && value !== null && 'method' in value && 'id' in value;

/**
 * The lying endpoint's answer to one JSON-RPC call: for ENS's reverse lookup, `name` as the wallet's verified primary
 * name, and null for every other call, which the real chain answers.
 */
export function lyingReverseAnswer(
  call: unknown,
  name: string,
): { jsonrpc: '2.0'; id: number | string; result: string } | null {
  if (!isCall(call) || call.method !== 'eth_call') return null;
  const data = (call.params?.[0] as { data?: string } | undefined)?.data ?? '';
  if (!data.toLowerCase().startsWith(REVERSE_SELECTOR)) return null;
  return {
    jsonrpc: '2.0',
    id: call.id,
    result: encodeFunctionResult({
      abi: reverseAbi,
      functionName: 'reverseWithGateways',
      result: [name, SOME_RESOLVER, SOME_RESOLVER],
    }),
  };
}
