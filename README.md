# GCS Narrative Tags

Extension for GCS-SSC that suggests and persists predefined and optional dynamic tags from configured narrative fields such as agreement and proponent descriptions.

## Model

The extension wraps `@browser-tag-extractor/core` and serves that package's bundled `Xenova/all-MiniLM-L12-v2` model through the extension asset pipeline. The worker configures the extractor to load model files from `/extensions/gcs-narrative-tags/models/`.

If the worker cannot initialize, the extension falls back to keyword overlap ranking against each configured tag and alias list.

Stream configuration exposes the extractor scoring controls used by the worker, including predefined thresholds, dynamic tag thresholds, phrase size, semantic and lexical weights, alias boost, negation handling, and browser/embedding cache toggles. These controls are configured per target field, so agreement descriptions and proponent descriptions can be enabled and tuned independently while sharing the same predefined tag vocabulary.

## Host Context

The grouped description slots expect entity-level bilingual description context:

- `kind: 'agreement.descriptions'` with `streamId`, `agreementId`, and `descriptions: { en, fr }`
- `kind: 'proponent.descriptions'` with `agencyId`, `applicantRecipientId`, and `descriptions: { en, fr }`

The extension combines the English and French text into one extractor input and persists one entity-level tag payload for the configured target.

## Development

```bash
bun install
bun run build:worker
bun run typecheck
bun run test:unit
```
