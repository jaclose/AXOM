import { useMemo } from "react";
import { useStore } from "./store";
import { normalizeDecodeState } from "./decode";
import type { DecodeState } from "./decodeTypes";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "./localVault";

export function useDecodeState(): DecodeState {
  const value = useStore((s) => s.decode);
  return useMemo(() => normalizeDecodeState(value), [value]);
}

/** A metadata edit never creates questions or attempts. */
export async function saveDecode(update: Partial<DecodeState> | ((state: DecodeState) => DecodeState)): Promise<void> {
  const current = normalizeDecodeState(useStore.getState().decode);
  const next = normalizeDecodeState(typeof update === "function" ? update(current) : { ...current, ...update });
  const checkpoint = getVaultWriteCheckpoint();
  useStore.setState({ decode: next });
  await flushLocalVaultWrites();
  assertVaultWritesSince(checkpoint);
}
