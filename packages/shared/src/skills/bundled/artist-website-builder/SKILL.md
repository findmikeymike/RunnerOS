---
name: artist-website-builder
description: "Use when building, editing, or rendering the artist website in `website/`. Triggers on 'build my site', 'make me a website', 'add the new single to the site', 'put the tour dates up', 'update my bio on the site', 'add a lyrics page', 'the site looks wrong', or any change to `website/content`, `website/site`, or `website/theme`. Covers the content contract, template syntax, the build and preview loop, and the rules that keep a site publishable. Pairs with the artist-website-playbook skill, which decides what a site should contain."
tags: [website, html, css, build, seo, preview, artist-os]
metadata:
  version: 1.0.0
  last_verified: 2026-09-03
---

# Artist Website Builder

The artist website is an HQ object at `website/`. You edit it with tools and a
bundled renderer, never by hand-writing HTML into `dist/`.

## The folder

```
website/
  site.json          manifest: mode, urls, domain, publish policy, last build
  content/site.json  the content contract — the source of truth
  theme/tokens.json  colors, type, radius, max width
  site/              templates you may edit (home, page, press, notfound, partials, styles.css)
  assets/            images and files copied into the build
  dist/              rendered output — disposable, never edit by hand
```

## Three laws

1. **Content is data.** Bio, releases, shows, videos, links, press, journal,
   pages, signup forms, and SEO defaults live in `content/site.json` and are
   edited with `website_set_content`. Never hand-edit that file, and never put
   copy directly into a template.
2. **`dist/` is disposable.** It is rendered from content, theme, and
   templates. If something is wrong in `dist/`, fix the input and rebuild.
3. **Never claim a build.** A build is done when `website_build` returns a
   hash and an audit score. Report those numbers, not an impression.

## The loop

```
website_get_manifest        does a site exist? what mode? what was the last build?
website_set_content         structured edits, one operation per thing changed
website_build               render + audit; returns hash, pages, score, warnings
website_preview             build + serve locally + show it in the canvas
website_seo_audit           score and a fix for each finding
```

Always call `website_get_manifest` first. If `mode` is `none`, there is no
site: use `website_create` with the artist's name. If `mode` is
`closed-builder` or `wordpress`, the artist has a site elsewhere and you do
not rebuild it.

After any change, build and preview. Show the artist the preview URL and the
audit score in the same message.

## Content operations

Each operation upserts by `id`, so re-sending the same `id` updates in place
instead of creating a duplicate. Pick stable ids (`r-cold-room`,
`show-2026-11-14-mpls`), not random ones.

```json
{ "operations": [
  { "op": "upsert-release", "value": { "id": "r-cold-room", "title": "Cold Room",
      "type": "album", "date": "2026-08-01", "featured": true,
      "links": { "spotify": "https://…", "smart": "https://…" } } },
  { "op": "upsert-show", "value": { "id": "show-2026-11-14-mpls", "date": "2026-11-14",
      "city": "Minneapolis, MN", "venue": "7th St Entry", "ticketUrl": "https://…" } },
  { "op": "set-artist", "value": { "tagline": "Songs from a cold room." } },
  { "op": "remove", "collection": "shows", "id": "show-2026-01-09-duluth" }
] }
```

Dates are `YYYY-MM-DD`. Shows sort ascending and split automatically into
upcoming and a past archive. Releases sort newest first. Exactly one release
should be `featured: true` — that is the hero.

Set `seo.canonicalBase` as soon as a domain is known. Without it there is no
sitemap and no canonical tags, and the audit will say so.

## Template syntax

Templates are plain HTML with a tiny mustache-style engine. No framework, no
bundler, no build step beyond the renderer.

```
{{ path }}                    escaped
{{{ path }}}                  raw — only for values the renderer produced
{{#if path}} … {{else}} … {{/if}}
{{#each list}} {{this.field}} {{@index}} {{/each}}
{{> partialName}}
```

`{{#if}}` treats an empty array as false, so `{{#if upcomingShows}}` is the
right way to branch on "are there shows".

Available to every page: `site` (artist, seo, links, socialLinks, storeLinks,
signup, primarySignup, year, themeCss, jsonLd, pages, hasPressPage) and `meta`
(title, description, canonical, noindex, og fields). The home page also gets
`featuredRelease`, `releases`, `upcomingShows`, `pastShows`, `videos`,
`featuredVideo`, and `journal`.

Referenced approved assets expose renderer-owned URLs: `artworkUrl` on
releases, `assetUrl` on videos and journal entries, `meta.ogImage`, and
`reward.assetUrl` on signup rewards. Never construct an asset path yourself.

Partials live in `site/partials/`. `head` emits the whole `<head>` including
Open Graph tags and the schema.org graph — always include it, or the audit
will flag missing structured data.

## Theme

`theme/tokens.json` becomes CSS custom properties. Change colors and type
there, not in `styles.css`, so every page stays consistent. Derive the palette
from the artist's branding context and the current release artwork rather than
inventing one.

## Hard rules

- **Never write a credential into content, a template, or an asset.** The
  build refuses to emit any file containing a key-shaped value and names the
  file and line. Keys belong in host environment variables.
- **Never link to a file outside the workspace.** Put images in
  `website/assets/` and reference them from there.
- **Never scrape a social platform for media.** Use the Vault, the Release
  Kit, or an official embed.
- **Every image needs alt text.** The audit fails you otherwise, and so does a
  screen reader.
- **One `<h1>` per page.**
- **You cannot publish.** There is no deploy tool in this skill. Build and
  preview, then hand the decision to the Website Agent and the artist.

## When the audit complains

The audit returns a `fix` for every finding. Work through them in severity
order: errors first, then warnings, then notices. A score under 80 is worth
fixing before showing the artist. Re-run `website_build` after each pass, and
report the new score.
