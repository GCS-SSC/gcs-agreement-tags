# GCS Agreement Tags

Extension for GCS-SSC that suggests and persists predefined and optional dynamic tags for English agreement descriptions.

## Model

The extension wraps `@browser-tag-extractor/core` and serves that package's bundled `Xenova/all-MiniLM-L12-v2` model through the extension asset pipeline. The worker configures the extractor to load model files from `/extensions/gcs-agreement-tags/models/`.

If the worker cannot initialize, the extension falls back to keyword overlap ranking against each configured tag and alias list.

Stream configuration exposes the extractor scoring controls used by the worker, including predefined thresholds, dynamic tag thresholds, phrase size, semantic and lexical weights, alias boost, negation handling, and browser/embedding cache toggles.

## Host Context

The textarea slot expects agreement description context:

- `kind: 'agreement.description'`
- `locale: 'en'`
- `text`
- `streamId`
- `agreementId`

Tags are saved through the extension server route only when the agreement id and stream id are available.

## Development

```bash
bun install
bun run build:worker
bun run typecheck
bun run test:unit
```
