import { useCallback } from "react";
import { useMutation as useRqMutation, useQuery as useRqQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient";
import type { Endpoint } from "../lib/api";

/**
 * Drop-in replacements for convex/react's useQuery / useMutation / useAction.
 *
 * They keep the same call shapes so the pages did not have to be rewritten, but
 * NOT the same semantics: Convex queries were live subscriptions that
 * re-rendered when the data changed on the server. These are cached fetches.
 * Freshness now comes from two places — a mutation invalidating the keys it
 * names, and the `refetchInterval` on the few reads that must notice writes
 * made outside this tab (see api.matching.list).
 */

/** Convex's sentinel for "don't run this query yet". */
export const SKIP = "skip" as const;

export function useApiQuery<Args, Result>(
  ep: Endpoint<Args, Result>,
  args?: Args | typeof SKIP,
): Result | undefined {
  const enabled = args !== SKIP;
  const callArgs = (enabled ? args : undefined) as Args;

  const { data } = useRqQuery({
    // Args are part of the key so a different filter is a different cache
    // entry, the way a different Convex query subscription was.
    queryKey: [ep.key, callArgs ?? null],
    queryFn: () =>
      apiFetch<Result>(ep.path(callArgs), {
        method: ep.method,
        body: ep.body ? ep.body(callArgs) : undefined,
      }),
    enabled,
    refetchInterval: ep.refetchInterval,
  });

  // `undefined` while loading, matching what Convex's useQuery returned — the
  // pages already branch on that to render their loading states.
  return data;
}

export function useApiMutation<Args, Result>(
  ep: Endpoint<Args, Result>,
): (args?: Args) => Promise<Result> {
  const queryClient = useQueryClient();
  const { mutateAsync } = useRqMutation({
    mutationFn: (args: Args) =>
      apiFetch<Result>(ep.path(args), {
        method: ep.method,
        body: ep.body ? ep.body(args) : undefined,
      }),
    onSuccess: () => {
      for (const key of ep.invalidates ?? []) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  // Convex mutations took no argument when they had none; keep that call shape.
  return useCallback((args?: Args) => mutateAsync((args ?? {}) as Args), [mutateAsync]);
}
