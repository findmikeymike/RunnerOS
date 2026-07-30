---
name: pod-listing-copy
description: Write Shopify and POD listing copy, titles, tags, product descriptions, collection blurbs, captions, and landing-page sections.
tags: [pod, copy, listings, shopify]
---

# POD Listing Copy

Use this skill for print-on-demand product copy.

Input rule:

- Prefer real product data: product brief, garment, print placement, colors, price, material, shipping/fulfillment notes, and target buyer.
- If the task is updating an existing Shopify product, fetch or request the current product/handle first.
- Do not write final publish-ready copy from vibes only; mark missing facts.

Copy rules:

- Write clear buyer-facing copy. No vague hype.
- Do not invent product claims, delivery promises, scarcity, or discounts.
- Keep SEO useful but human-readable.
- Separate Shopify product copy, social captions, and internal notes.
- Include a short reason for each title or angle.
- Ban empty hype: "high-quality", "premium", "best-in-class", "amazing", "perfect", "revolutionary", "game-changing".
- Use clean Shopify HTML for full descriptions. No inline styles.

Shopify HTML shape:

```html
<div class="product-description">
  <p class="product-hook">One concrete opening sentence.</p>
  <p class="product-body">Two or three sentences on buyer, feeling, use, or identity.</p>
  <ul class="product-features">
    <li>Feature or fit note.</li>
    <li>Print/product detail.</li>
    <li>Care, styling, or collection fit.</li>
  </ul>
  <p class="product-cta">Subtle closing line.</p>
</div>
```

SEO/PDP checks:

- Title should be readable and include the core product/search phrase.
- Description should support Product/Offer schema facts when the storefront has them.
- Image alt text should describe the design and product, not keyword-stuff.
- Category/collection fit should be explicit.
- If variants/colors create duplicate pages, recommend canonical/category handling instead of writing duplicate copy.

Default output:

1. Product title options.
2. Short description.
3. Full product description.
4. SEO title/meta description.
5. Image alt text.
6. Tags and collection fit.
7. Social caption variants.
8. Missing facts and approval notes.
