import { defineExtension } from "@tracht-digital-solutions/tds-frontend-contract";

/**
 * Website-CMS extension — request-time content management for public sites,
 * ported from tds-content-api's `/landing` content-block model. Edits website
 * sections stored as one JSON block per site × section × language; public sites
 * merge these over local defaults and refresh affected page-cache entries after
 * a save, so a missing block remains a working default.
 *
 * A `cms_site` registry lets one panel manage several sites. Registration and
 * cache/CI configuration live under Settings; the CMS screen only selects a
 * site, page and section for editing. `website:read`/`website:write` gate it.
 */
export default defineExtension({
  id: "website-cms",
  name: "Website-CMS",
  version: "0.1.0",
  permissions: [
    { id: "website:read", label: "Website-Inhalte ansehen", group: "website-cms" },
    { id: "website:write", label: "Website-Inhalte bearbeiten", group: "website-cms" },
  ],
  nav: [
    {
      id: "website-cms",
      label: "Website-CMS",
      href: "/website",
      icon: "layout",
      group: "content",
      order: 20,
      permission: "website:read",
    },
  ],
  widgets: [
    {
      id: "website-cms-sites",
      title: "Websites",
      island: "@tracht-digital-solutions/tds-ext-website-cms/widgets/Widget.astro",
      size: "sm",
      permission: "website:read",
      dataEndpoint: "/cms/summary",
      order: 30,
    },
  ],
  settings: [
    {
      id: "website-cms",
      label: "Website-CMS",
      island: "@tracht-digital-solutions/tds-ext-website-cms/islands/Settings.astro",
      order: 40,
    },
  ],
  routes: [
    {
      pattern: "/website",
      entrypoint: "@tracht-digital-solutions/tds-ext-website-cms/pages/Index.astro",
      permission: "website:read",
    },
  ],
  i18n: {
    de: { "website.title": "Website-CMS", "website.sites": "Websites" },
    en: { "website.title": "Website CMS", "website.sites": "Websites" },
  },
});
