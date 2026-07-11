import type { MetadataRoute } from "next"

// Generates /robots.txt at build time. Public marketing/disclosure pages (/, /legal,
// /privacy) stay indexable; the gated app (/dashboard) and any future route handlers
// (/api) are disallowed. /_next/* is deliberately NOT blocked — blocking it hurts
// render-based crawlers. Domain reused from the app's metadataBase.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard/", "/api/"],
      },
    ],
    sitemap: "https://purserpay.app/sitemap.xml",
    host: "https://purserpay.app",
  }
}
