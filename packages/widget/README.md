# @hammerock/cca-widget

An embeddable card that shows a live [Uniswap Continuous Clearing Auction](https://github.com/Uniswap/continuous-clearing-auction) and lets visitors bid on it from your own site.

You can use it as a **React component**, or on **any website with a `<script>` tag**, no build step needed.

> **Networks.** Ethereum (1), Base (8453), Unichain (130) and Arbitrum One (42161), plus Sepolia (11155111), Base Sepolia (84532) and Unichain Sepolia (1301). On a mainnet the bid form spends the visitor's real funds - their own wallet shows and signs every transaction.

The card shows the clearing price, amount raised, supply cleared, supply schedule progress, time remaining and graduation status. It refreshes every 12 seconds and stops polling once the auction ends.

## React

```bash
npm install @hammerock/cca-widget viem react react-dom
```

```tsx
import { AuctionCard } from "@hammerock/cca-widget";

export function Launch() {
  return (
    <AuctionCard
      auction="0x1e40451D6ecabA8640559b7dFbe63B41dA52460d"
      chainId={11155111}
      rpcUrl="https://ethereum-sepolia-rpc.publicnode.com"
    />
  );
}
```

The build includes `"use client"`, so you can import it straight into a **Next.js App Router** page.

## Any website

```html
<div id="beacon"></div>

<script src="https://cdn.jsdelivr.net/npm/@hammerock/cca-widget@0.1.0/dist/mount.global.js"></script>
<script>
  const card = BeaconCCA.mount("#beacon", {
    auction: "0x1e40451D6ecabA8640559b7dFbe63B41dA52460d",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  });

  // Later, if needed:
  // card.update({ auction: "0x..." });
  // card.unmount();
</script>
```

This bundle includes React, so the page needs nothing else. It is about 540 KB.

## Props

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `auction` | `` `0x${string}` `` | yes | The `ContinuousClearingAuction` address |
| `chainId` | `number` | yes | Must be a supported testnet |
| `rpcUrl` | `string` | yes | **A public RPC endpoint** — see below |
| `lensAddress` | `` `0x${string}` `` | no | A deployed `AuctionStateLens`. Leave it out and the widget reads state without one. |
| `pollIntervalMs` | `number` | no | Refresh interval, default `12000` |
| `readOnly` | `boolean` | no | Hide the bid form |

**Never pass an RPC URL that contains an API key.** The widget runs in your visitors' browsers, so anything in `rpcUrl` is visible to them.

## Bidding

Visitors need a browser wallet such as MetaMask. The widget connects through the wallet's standard provider (EIP-1193), so you don't need wagmi or any provider setup. It also asks the wallet to switch to the right network.

What the widget handles for the visitor:

- **ERC-20 auctions** need approvals through Permit2 before the bid. The widget sends only the approvals that are missing, then the bid.
- **Prices are rounded down to the auction's tick spacing**, because the contract rejects any other price. The form shows the adjusted price before the visitor confirms.
- **Closed or not-yet-open auctions** show a clear message and a disabled button instead of a bid that would fail.
- It checks the visitor's balance before sending anything.

## Using the hook directly

To build your own UI, use the data hook that powers the card:

```tsx
import { useAuction } from "@hammerock/cca-widget";

const { data, error, loading, refresh } = useAuction({
  auction: "0x1e40451D6ecabA8640559b7dFbe63B41dA52460d",
  chainId: 11155111,
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
});
```

For lower-level access (discovery, Q96 math, bid construction), use [`@hammerock/cca-sdk`](https://www.npmjs.com/package/@hammerock/cca-sdk), which this widget is built on.

Source: [github.com/Shubham-Singh-Shoora/Beacon-](https://github.com/Shubham-Singh-Shoora/Beacon-).

## License

MIT
