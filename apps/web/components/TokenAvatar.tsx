import { BeaconMark } from "./Icons";
export function TokenAvatar({
  symbol,
  address,
  large = false,
}: {
  symbol: string;
  address: string;
  large?: boolean;
}) {
  const palette = parseInt(address.slice(-4), 16) % 6;
  return (
    <span
      className={`token-avatar token-color-${palette}${large ? " token-avatar-large" : ""}`}
      aria-hidden="true"
    >
      {symbol === "BEACON" ? <BeaconMark /> : symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}
