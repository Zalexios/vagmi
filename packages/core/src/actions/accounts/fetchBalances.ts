import { formatUnits, parseBytes32String } from 'ethers/lib/utils.js';
import {
  erc20ABI,
  getProvider,
  readContracts,
  allChains,
  Address,
} from '@wagmi/core';
import type {
  FetchBalanceResult as _FetchBalanceResult,
} from '@wagmi/core';
import { BigNumber } from 'ethers';

export interface FetchBalanceResult extends _FetchBalanceResult {
  token?: Address;
}

type ReadContractsParams = Parameters<typeof readContracts>[0];
export type MulticallContract = ReadContractsParams['contracts'][0];

export type FetchBalancesArgs = {
  /** Address of balance to check */
  address: Address;
  /** Chain id to use for provider */
  chainId?: number;
  /** ERC-20 addresses */
  tokens: Address|Address[];
}

export const fetchBalances = async ({
  address,
  chainId,
  tokens,
}: FetchBalancesArgs): Promise<FetchBalanceResult[]> => {
  const provider = getProvider({ chainId });

  if (!!tokens && tokens.length > 0) {
    type FetchContractBalance = { abi: typeof erc20ABI }

    const fetchContractBalances = async ({ abi }: FetchContractBalance) => {
      tokens = Array.isArray(tokens) ? tokens : [tokens];
      const erc20Configs = tokens.map(v => ({ abi, address: v, chainId }));
      const contracts = erc20Configs.flatMap(v => {
        return [
          {
            ...v,
            functionName: 'balanceOf',
            args: [ address ],
          },
          { ...v, functionName: 'decimals' },
          { ...v, functionName: 'symbol' },
        ] as MulticallContract[];
      });
      const data = await readContracts({
        allowFailure: false,
        contracts,
      });
      let balances = [] as FetchBalanceResult[];
      let cycle = 0;
      let value: BigNumber, decimals: number, symbol: string;

      data.forEach((v, i) => {
        if (cycle === 0) {
          cycle = 3;
        }
        if (cycle === 3) {
          value = v as unknown as BigNumber;
        } else if (cycle === 2) {
          decimals = v as unknown as number;
        } else if (cycle === 1) {
          symbol = '';
          try {
            symbol = v as unknown as string;
          } catch (symbolParseError) {
            symbol = parseBytes32String(v as unknown as string);
            console.error(symbolParseError);
            console.warn(v);
            console.log(typeof(v));
          }

          balances.push({
            token: contracts[i].address as Address,
            value,
            decimals,
            symbol,
            formatted: formatUnits(value ?? '0', decimals),
          });
        }
        cycle--;
      });

      return balances;
    }

    try {
      return await fetchContractBalances({ abi: erc20ABI });
    } catch (err) {
      // TODO: create modified readContracts specifically for multicall
      // fetchBalances to handle ContractResultDecodeError.
      // NOTE: Determine if handling of symbol as string/bytes32 above
      // is all that is required.
      throw err;
    }
  }

  const value = await provider.getBalance(address);
  const chain = allChains.find(x => x.id === provider.network.chainId);
  return [{
    token: (chain?.nativeCurrency?.name ?? '0x0000000000000000000000000000000000000000') as Address,
    decimals: chain?.nativeCurrency?.decimals ?? 18,
    formatted: formatUnits(value ?? '0', chain?.nativeCurrency?.decimals ?? 'ether'),
    symbol: chain?.nativeCurrency?.symbol ?? 'ETH',
    value,
  }] as FetchBalanceResult[];
}