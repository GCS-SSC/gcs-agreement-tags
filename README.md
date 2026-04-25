# GCS Agreement Tags

Extension for GCS-SSC that suggests and persists predefined tags for English agreement descriptions.

## Model

The extension ships `Xenova/all-MiniLM-L6-v2` as a local quantized ONNX model under `models/`. The model assets are about 23 MB and run in a browser worker through `@huggingface/transformers` and `onnxruntime-web`.

If the worker cannot initialize, the extension falls back to keyword overlap ranking against each configured tag and alias list.

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
