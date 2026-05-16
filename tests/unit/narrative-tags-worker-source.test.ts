import { beforeEach, describe, expect, it, vi } from 'vitest'

const extractMock = vi.fn()
const loadModelMock = vi.fn()

vi.mock('@browser-tag-extractor/core/benchmark', () => ({
  createTransformersTagExtractor: vi.fn(() => ({
    loadModel: loadModelMock,
    extract: extractMock
  })),
  rankTagsByKeywordOverlap: vi.fn(() => [
    { key: 'fallback-tag', score: 0.75 }
  ]),
  resolveTagExtractorConfig: vi.fn(config => config)
}))

describe('narrative tags worker source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadModelMock.mockResolvedValue(undefined)
    extractMock.mockResolvedValue({
      predefined: [{ key: 'infrastructure', score: 0.82 }],
      dynamic: [{ label: 'regional rail', score: 0.7 }]
    })
  })

  it('normalizes tag definitions before scoring', async () => {
    const { toTagDefinition } = await import('../../client/worker-source')

    expect(toTagDefinition({
      key: ' infrastructure ',
      label: { en: ' Infrastructure ', fr: '' },
      description: { en: ' Capital ', fr: '' },
      aliases: [' roads ', '', null]
    })).toEqual({
      key: 'infrastructure',
      label: {
        en: 'Infrastructure',
        fr: ''
      },
      description: {
        en: 'Capital',
        fr: ''
      },
      aliases: ['roads', 'null']
    })
  })

  it('returns extractor suggestions for valid payloads', async () => {
    const { suggestTags } = await import('../../client/worker-source')

    await expect(suggestTags({
      text: 'The project improves infrastructure.',
      locale: 'en',
      tags: [{
        key: 'infrastructure',
        label: { en: 'Infrastructure', fr: 'Infrastructure' }
      }]
    })).resolves.toEqual([
      { predefined: true, key: 'infrastructure', score: 0.82 },
      { predefined: false, label: 'regional rail', score: 0.7 }
    ])
  })

  it('falls back to keyword overlap when extraction fails', async () => {
    extractMock.mockRejectedValueOnce(new Error('model failed'))
    const { suggestTags } = await import('../../client/worker-source')

    await expect(suggestTags({
      text: 'The project improves infrastructure.',
      locale: 'en',
      tags: [{
        key: 'infrastructure',
        label: { en: 'Infrastructure', fr: 'Infrastructure' }
      }]
    })).resolves.toEqual([
      { predefined: true, key: 'fallback-tag', score: 0.75 }
    ])
  })
})
