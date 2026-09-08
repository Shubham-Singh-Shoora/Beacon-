/**
 * Wallet access for the bid form.
 *
 * Deliberately uses the EIP-1193 provider the browser already exposes
 * (`window.ethereum`) through viem, rather than wagmi.
 *
 * Reasoning: this widget's whole point is that a project can drop it into their
 * own site. wagmi requires the host page to wrap the tree in `WagmiProvider`
 * plus a React Query client, which a plain marketing site cannot do at all, and
 * which the vanilla `<script>` mount path would have to bundle wholesale. Going
 * straight to EIP-1193 keeps the widget self-contained and works identically in
 * the React and vanilla builds. A host that already uses wagmi can pass its own
 * wallet client in instead.
 */
import { createWalletClient, custom } from "viem";
import type { Address, Chain, WalletClient } from "viem";

/** The subset of EIP-1193 the widget needs. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider | undefined {
  return typeof window === "undefined" ? undefined : window.ethereum;
}

export function hasInjectedWallet(): boolean {
  return getInjectedProvider() !== undefined;
}

export interface ConnectedWallet {
  address: Address;
  walletClient: WalletClient;
  chainId: number;
}

/** Prompt the wallet to connect, and switch chain if it is on the wrong one. */
export async function connectWallet(chain: Chain): Promise<ConnectedWallet> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
  }

  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  const address = accounts[0];
  if (!address) throw new Error("Wallet returned no accounts.");

  const currentChainId = Number(
    (await provider.request({ method: "eth_chainId" })) as string,
  );

  if (currentChainId !== chain.id) {
    await switchChain(provider, chain);
  }

  const walletClient = createWalletClient({ account: address, chain, transport: custom(provider) });
  return { address, walletClient, chainId: chain.id };
}

async function switchChain(provider: Eip1193Provider, chain: Chain): Promise<void> {
  const chainIdHex = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    // 4902: the wallet does not know this chain yet, so offer to add it.
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrls.default.http[0]],
          blockExplorerUrls: chain.blockExplorers?.default?.url
            ? [chain.blockExplorers.default.url]
            : undefined,
        },
      ],
    });
  }
}
