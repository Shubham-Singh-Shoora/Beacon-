#!/usr/bin/env bash
# Compile the demo ERC-20 and emit its ABI + creation bytecode as TypeScript.
# Requires foundry. On Windows, run inside WSL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contracts/demo"
forge build >/dev/null
OUT="$ROOT/packages/sdk/src/demo"
mkdir -p "$OUT"
ARTIFACT=out/BeaconDemoToken.sol/BeaconDemoToken.json
{
  echo "// GENERATED FILE - DO NOT EDIT."
  echo "// Source: contracts/demo/src/BeaconDemoToken.sol"
  echo "// Regenerate with: ./contracts/build-demo.sh"
  echo
  echo "export const demoTokenAbi = $(jq -c '.abi' $ARTIFACT) as const;"
  echo
  echo "/** Creation bytecode. Constructor args: (string name, string symbol, uint256 supply). */"
  echo "export const demoTokenBytecode = $(jq -c '.bytecode.object' $ARTIFACT) as const;"
} > "$OUT/token.ts"
echo "wrote $OUT/token.ts"
