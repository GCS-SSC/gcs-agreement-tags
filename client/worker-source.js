/* eslint-disable jsdoc/require-jsdoc */
import { env as transformersEnv, pipeline } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const MODEL_BASE_PATH = '/extensions/gcs-agreement-tags/models/'
const WASM_BASE_PATH = '/extensions/gcs-agreement-tags/ort/'

let extractorPromise = null
const embeddingCache = new Map()

const tokenize = value => String(value)
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(token => token.length > 2)

const rankTagsByKeywordOverlap = (text, tags, maxSuggestions) => {
  const textTokens = new Set(tokenize(text))
  if (textTokens.size === 0) {
    return []
  }

  return tags
    .map(tag => {
      const tagText = [tag.label?.en, tag.description?.en, ...(Array.isArray(tag.aliases) ? tag.aliases : [])]
        .filter(Boolean)
        .join('. ')
      const tagTokens = new Set(tokenize(tagText))
      const hits = Array.from(tagTokens).filter(token => textTokens.has(token)).length
      const aliasHits = (Array.isArray(tag.aliases) ? tag.aliases : [])
        .map(alias => tokenize(alias))
        .filter(aliasTokens => aliasTokens.length > 0 && aliasTokens.every(token => textTokens.has(token))).length
      return {
        key: tag.key,
        score: Math.min(1, (tagTokens.size > 0 ? hits / tagTokens.size : 0) + (aliasHits > 0 ? 0.45 : 0))
      }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
}

const getExtractor = async () => {
  if (!extractorPromise) {
    transformersEnv.allowRemoteModels = false
    transformersEnv.allowLocalModels = true
    transformersEnv.localModelPath = MODEL_BASE_PATH
    transformersEnv.backends.onnx.wasm.wasmPaths = WASM_BASE_PATH
    transformersEnv.backends.onnx.wasm.proxy = false
    transformersEnv.useBrowserCache = true

    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      quantized: true
    })
  }

  return await extractorPromise
}

const toVector = output => {
  if (output?.data && typeof output.data.length === 'number') {
    return Array.from(output.data)
  }

  if (Array.isArray(output)) {
    return output.flat(Infinity)
  }

  return []
}

const embed = async text => {
  const cacheKey = String(text)
  const cached = embeddingCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const extractor = await getExtractor()
  const output = await extractor(cacheKey, {
    pooling: 'mean',
    normalize: true
  })
  const vector = toVector(output)
  embeddingCache.set(cacheKey, vector)
  return vector
}

const cosineSimilarity = (left, right) => {
  const length = Math.min(left.length, right.length)
  if (length === 0) {
    return 0
  }

  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

const tagText = tag => [
  tag.label?.en,
  tag.description?.en,
  ...(Array.isArray(tag.aliases) ? tag.aliases : [])
].filter(Boolean).join('. ')

const suggestTags = async payload => {
  const text = String(payload.text ?? '').trim()
  const tags = Array.isArray(payload.tags) ? payload.tags : []
  const maxSuggestions = Number.isFinite(Number(payload.maxSuggestions)) ? Number(payload.maxSuggestions) : 4
  const minScore = Number.isFinite(Number(payload.minScore)) ? Number(payload.minScore) : 0.36

  if (!text || tags.length === 0) {
    return []
  }

  try {
    const textEmbedding = await embed(text)
    const scored = await Promise.all(tags.map(async tag => ({
      key: tag.key,
      score: Math.min(
        1,
        (cosineSimilarity(textEmbedding, await embed(tagText(tag))) * 0.75)
        + ((rankTagsByKeywordOverlap(text, [tag], 1)[0]?.score ?? 0) * 0.25)
      )
    })))

    return scored
      .filter(item => item.key && item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestions)
  } catch {
    return rankTagsByKeywordOverlap(text, tags, maxSuggestions)
  }
}

if (typeof self !== 'undefined') {
  self.addEventListener('message', event => {
    if (event.data?.type !== 'suggest') {
      return
    }

    const requestId = typeof event.data?.requestId === 'number' ? event.data.requestId : 0
    void suggestTags(event.data.payload ?? {}).then(suggestions => {
      self.postMessage({
        kind: 'result',
        requestId,
        suggestions
      })
    }).catch(error => {
      self.postMessage({
        kind: 'error',
        requestId,
        error: error instanceof Error ? error.message : 'AGREEMENT_TAGS_WORKER_ERROR'
      })
    })
  })
}
