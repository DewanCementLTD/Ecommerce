import { jsonLdScript } from '../lib/seo.js';

/**
 * One structured-data block. Rendered inside the page body rather than the
 * head: `<script type="application/ld+json">` is valid in either, and Next's
 * metadata API has no slot for arbitrary JSON-LD.
 *
 * The payload is escaped by jsonLdScript() — product names and descriptions are
 * client-authored text and would otherwise be able to close the script element.
 */
export function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  );
}
