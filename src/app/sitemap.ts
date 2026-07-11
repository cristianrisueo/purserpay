import type { MetadataRoute } from "next"

// Generates /sitemap.xml at build time. The public site is a single landing page, so the
// sitemap points only at the homepage (the dashboard is gated and intentionally excluded).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://purserpay.app",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ]
}
