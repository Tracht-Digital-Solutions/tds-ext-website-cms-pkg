import { useEffect, useState } from "react";

/**
 * "Websites" widget body — the count of managed sites, from the manifest's
 * dataEndpoint (/cms/summary).
 */
export default function ManagedSitesCount() {
  const [sites, setSites] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/cms/summary", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { sites: 0 }))
      .then((d) => alive && setSites(Number(d.sites ?? 0)))
      .catch(() => alive && setSites(0));
    return () => {
      alive = false;
    };
  }, []);
  return <p className="widget__metric">{sites === null ? "…" : sites}</p>;
}
