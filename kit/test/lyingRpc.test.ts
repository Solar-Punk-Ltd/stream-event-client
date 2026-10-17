import { decodeFunctionResult, encodeFunctionData, parseAbi, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { lyingReverseAnswer } from '../src/lyingRpc.ts';

const abi = parseAbi([
  'function reverseWithGateways(bytes reverseName, uint256 coinType, string[] gateways) view returns (string resolvedName, address resolver, address reverseResolver)',
  'function resolveWithGateways(bytes name, bytes data, string[] gateways) view returns (bytes result, address resolver)',
]);
const WALLET = '0x1111111111111111111111111111111111111111';

const call = (data: string, id: number | string = 7) => ({
  jsonrpc: '2.0',
  id,
  method: 'eth_call',
  params: [{ to: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', data }, 'latest'],
});

describe('lyingReverseAnswer', () => {
  it("answers ENS's reverse lookup with the false name, as a primary name whose record names the wallet back", () => {
    const data = encodeFunctionData({
      abi,
      functionName: 'reverseWithGateways',
      args: [WALLET, 60n, ['x-batch-gateway:true']],
    });
    const answer = lyingReverseAnswer(call(data), 'someone-else.eth');
    expect(answer).toMatchObject({ jsonrpc: '2.0', id: 7 });
    const [name] = decodeFunctionResult({
      abi,
      functionName: 'reverseWithGateways',
      data: (answer as { result: `0x${string}` }).result,
    });
    expect(name).toBe('someone-else.eth');
  });

  it('leaves every other call to the real chain', () => {
    const other = encodeFunctionData({ abi, functionName: 'resolveWithGateways', args: [toHex('x'), '0x', []] });
    expect(lyingReverseAnswer(call(other), 'someone-else.eth')).toBeNull();
    expect(lyingReverseAnswer({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, 'x.eth')).toBeNull();
    expect(lyingReverseAnswer('not a call', 'x.eth')).toBeNull();
  });
});
