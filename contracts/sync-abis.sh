#!/usr/bin/env bash
# Regenerate packages/sdk/src/abis/*.ts from Uniswap/continuous-clearing-auction.
#
# The ABIs Beacon uses are COMPILED FROM PINNED UPSTREAM SOURCE, never
# hand-written. Run this to reproduce or refresh them.
#
# Requires: foundry (forge), jq, git.  On Windows, run inside WSL.
#
#   ./contracts/sync-abis.sh
set -euo pipefail

# The deployed ContinuousClearingAuctionFactory on Sepolia
# (0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5) has runtime bytecode that is
# byte-for-byte identical to a local build of this tag. Do not bump it without
# re-verifying against the chain.
UPSTREAM_TAG="v1.1.0"
UPSTREAM_REPO="https://github.com/Uniswap/continuous-clearing-auction.git"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/packages/sdk/src/abis"
WORK_DIR="${CCA_WORK_DIR:-$HOME/.cache/beacon/continuous-clearing-auction}"

echo "==> upstream $UPSTREAM_TAG -> $WORK_DIR"
if [ ! -d "$WORK_DIR/.git" ]; then
  mkdir -p "$(dirname "$WORK_DIR")"
  git clone "$UPSTREAM_REPO" "$WORK_DIR"
fi
cd "$WORK_DIR"
git fetch --tags --quiet
git checkout --quiet "$UPSTREAM_TAG"
git submodule update --init --recursive --depth 1 --quiet
COMMIT="$(git rev-parse HEAD)"
echo "==> commit $COMMIT"

echo "==> forge build"
forge build --skip test --skip script >/dev/null

mkdir -p "$OUT_DIR"

# $1 = contract name, $2 = output basename, $3 = "withBytecode" to also emit
# the deployed bytecode (needed for the eth_call state-override read path).
emit() {
  local contract="$1" out="$2" with_bytecode="${3:-}"
  local artifact="out/$contract.sol/$contract.json"
  local target="$OUT_DIR/$out.ts"

  {
    echo "// GENERATED FILE - DO NOT EDIT."
    echo "// Source: Uniswap/continuous-clearing-auction @ $UPSTREAM_TAG ($COMMIT)"
    echo "// Contract: $contract"
    echo "// Regenerate with: ./contracts/sync-abis.sh"
    echo
    echo "export const ${out}Abi = $(jq -c '.abi' "$artifact") as const;"
    if [ "$with_bytecode" = "withBytecode" ]; then
      echo
      echo "/** Deployed runtime bytecode, for eth_call state-override reads."
      echo " *  Lets Beacon run the lens without deploying it. */"
      echo "export const ${out}DeployedBytecode = $(jq -c '.deployedBytecode.object' "$artifact") as const;"
    fi
  } > "$target"
  echo "    wrote $out.ts ($(jq '.abi|length' "$artifact") abi entries)"
}

echo "==> emitting ABIs"
emit ContinuousClearingAuction        auction
emit ContinuousClearingAuctionFactory factory
emit AuctionStateLens                 auctionStateLens withBytecode

cat > "$OUT_DIR/index.ts" <<EOF
// GENERATED FILE - DO NOT EDIT.
// Source: Uniswap/continuous-clearing-auction @ $UPSTREAM_TAG ($COMMIT)
// Regenerate with: ./contracts/sync-abis.sh

/** Upstream tag these ABIs were compiled from. */
export const UPSTREAM_TAG = "$UPSTREAM_TAG";
/** Exact upstream commit these ABIs were compiled from. */
export const UPSTREAM_COMMIT = "$COMMIT";

export { auctionAbi } from "./auction";
export { factoryAbi } from "./factory";
export { auctionStateLensAbi, auctionStateLensDeployedBytecode } from "./auctionStateLens";
EOF
echo "    wrote index.ts"
echo "==> done"
