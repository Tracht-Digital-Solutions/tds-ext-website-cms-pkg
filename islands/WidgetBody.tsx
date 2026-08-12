import { useEffect, useState } from "react";
import { Skeleton } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

/**
 * "Websites" widget body — the count of managed sites, from the manifest's
 * dataEndpoint (/cms/summary).
 */
export default function ManagedSitesCount() {
  const [sites, setSites] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch("/cms/summary")
      .then((r) => (r.ok ? r.json() : { sites: 0 }))
      .then((d) => alive && setSites(Number(d.sites ?? 0)))
      .catch(() => alive && setSites(0));
    return () => {
      alive = false;
    };
  }, []);
  return <p className="tds-widget__metric" aria-busy={sites === null}>
      {sites === null ? <Skeleton width="3ch" height="1.75rem" /> : sites}
    </p>;
}
