import type { QueryClient } from "@tanstack/react-query";

/** Assignment writes refresh queue, scoped customer reads and open audits, not recovery logs. */
export function invalidateAssignmentQueries(client: QueryClient) {
  return client.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === "string"
      && query.queryKey[0].startsWith("/api/admin/customer-assignments"),
  });
}