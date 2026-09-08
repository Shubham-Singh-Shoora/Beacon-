/**
 * Vanilla-JS entry point so non-React sites can embed the widget:
 *
 *   <div id="beacon"></div>
 *   <script src="https://your-cdn/mount.global.js"></script>
 *   <script>
 *     BeaconCCA.mount('#beacon', {
 *       auction: '0x...', chainId: 11155111, rpcUrl: 'https://...'
 *     });
 *   </script>
 *
 * React and the SDK are bundled into this build, so the host page needs nothing.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { AuctionCard } from "./AuctionCard";
import type { AuctionCardProps } from "./AuctionCard";

const roots = new WeakMap<Element, Root>();

export interface MountHandle {
  update(next: Partial<AuctionCardProps>): void;
  unmount(): void;
}

export function mount(target: string | Element, props: AuctionCardProps): MountHandle {
  const element = typeof target === "string" ? document.querySelector(target) : target;
  if (!element) {
    throw new Error(`Beacon widget: no element matched ${String(target)}`);
  }

  // Re-mounting into the same node reuses its root, so calling mount() twice
  // updates in place instead of leaking a second React tree.
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }

  let current = props;
  root.render(createElement(AuctionCard, current));

  return {
    update(next) {
      current = { ...current, ...next };
      root!.render(createElement(AuctionCard, current));
    },
    unmount() {
      root!.unmount();
      roots.delete(element);
    },
  };
}

export { AuctionCard };
export type { AuctionCardProps };
