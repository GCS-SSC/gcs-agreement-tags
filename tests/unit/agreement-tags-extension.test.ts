/* eslint-disable jsdoc/require-jsdoc */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import extensionDefinition from '../../extension.config'
import {
  normalizeAgreementTagsConfig,
  rankTagsByKeywordOverlap,
  resolveAgreementTagsTextareaContext,
  toAgreementTagsJson
} from '../../components/agreement-tags'
import {
  getPersistedAgreementTags,
  setPersistedAgreementTags,
  validateRequestedTags
} from '../../server/agreement-tags-route'

const createQueryChain = (executeTakeFirstResult?: Record<string, unknown>) => {
  const chain = {
    innerJoin: () => chain,
    select: () => chain,
    where: () => chain,
    values: () => chain,
    set: () => chain,
    returningAll: () => chain,
    executeTakeFirst: async () => executeTakeFirstResult
  }
  return chain
}

describe('gcs agreement tags extension', () => {
  it('declares stream configuration, runtime slot, static assets, and extension routes', () => {
    expect(extensionDefinition.key).toBe('gcs-agreement-tags')
    expect(extensionDefinition.admin?.streamConfig?.path).toBe('./components/AgreementTagsConfig.vue')
    expect(extensionDefinition.client?.slots?.map(slot => slot.slot)).toEqual(['textarea.after'])
    expect(extensionDefinition.assets).toEqual([
      {
        path: './client',
        baseURL: '/extensions/gcs-agreement-tags/client'
      },
      {
        path: './models',
        baseURL: '/extensions/gcs-agreement-tags/models'
      },
      {
        package: 'onnxruntime-web',
        packagePath: 'dist',
        baseURL: '/extensions/gcs-agreement-tags/ort'
      }
    ])
    expect(extensionDefinition.serverHandlers?.map(handler => handler.route)).toEqual([
      '/streams/[streamId]/agreements/[agreementId]/tags',
      '/streams/[streamId]/agreements/[agreementId]/tags'
    ])
  })

  it('normalizes config and drops duplicate or invalid tag keys', () => {
    const config = normalizeAgreementTagsConfig({
      enabled: false,
      minScore: 2,
      maxSuggestions: '3',
      tags: [
        {
          key: ' Community Benefit ',
          label: { en: 'Community', fr: 'Collectivité' },
          description: { en: 'Public benefit', fr: 'Avantage public' },
          aliases: [' community ', 'community'],
          color: 'success'
        },
        {
          key: 'community-benefit',
          label: { en: 'Duplicate', fr: 'Doublon' }
        },
        {
          key: '',
          label: { en: '', fr: '' }
        }
      ]
    })

    expect(config.enabled).toBe(false)
    expect(config.minScore).toBe(1)
    expect(config.maxSuggestions).toBe(3)
    expect(config.tags).toEqual([{
      key: 'community-benefit',
      label: { en: 'Community', fr: 'Collectivité' },
      description: { en: 'Public benefit', fr: 'Avantage public' },
      aliases: ['community'],
      color: 'success'
    }])
    expect(toAgreementTagsJson(config).tags).toHaveLength(1)
  })

  it('resolves only English agreement description textarea contexts', () => {
    expect(resolveAgreementTagsTextareaContext({
      textarea: {
        kind: 'agreement.description',
        locale: 'en',
        text: ' Infrastructure project ',
        streamId: '31',
        agreementId: '44'
      }
    })).toEqual({
      kind: 'agreement.description',
      locale: 'en',
      label: '',
      text: 'Infrastructure project',
      streamId: '31',
      agreementId: '44'
    })

    expect(resolveAgreementTagsTextareaContext({
      textarea: {
        kind: 'agreement.description',
        locale: 'fr',
        text: 'Projet'
      }
    })).toBeNull()
  })

  it('ranks only predefined tags without inventing new labels', () => {
    const config = normalizeAgreementTagsConfig({})
    const ranked = rankTagsByKeywordOverlap(
      'This agreement funds equipment for a local facility and capital project.',
      config.tags,
      2
    )

    expect(ranked.map(item => item.key)).toContain('infrastructure')
    expect(ranked.every(item => config.tags.some(tag => tag.key === item.key))).toBe(true)
  })

  it('validates persisted tags against stream configuration', () => {
    const config = normalizeAgreementTagsConfig({})

    expect(validateRequestedTags(config, ['infrastructure', 'infrastructure'])).toEqual(['infrastructure'])
    expect(validateRequestedTags(config, ['invented-tag'])).toBeNull()
    expect(validateRequestedTags(config, 'infrastructure')).toBeNull()
  })

  it('reads and upserts agreement tags through extension-owned KV rows', async () => {
    const readQuery = createQueryChain({ value: ['infrastructure', 3, 'community-benefit'] })
    const missingQuery = createQueryChain()
    const insertQuery = createQueryChain({ id: 'created' })
    const existingQuery = createQueryChain({ id: 'existing' })
    const updateQuery = createQueryChain({ id: 'existing', value: ['capacity-building'] })
    const db = {
      selectFrom: vi.fn()
        .mockReturnValueOnce(readQuery)
        .mockReturnValueOnce(missingQuery)
        .mockReturnValueOnce(existingQuery),
      insertInto: vi.fn(() => insertQuery),
      updateTable: vi.fn(() => updateQuery)
    }

    await expect(getPersistedAgreementTags(db as never, 'gcs-agreement-tags', '44')).resolves.toEqual([
      'infrastructure',
      'community-benefit'
    ])
    await expect(setPersistedAgreementTags(db as never, 'gcs-agreement-tags', '44', ['infrastructure'])).resolves.toEqual({ id: 'created' })
    await expect(setPersistedAgreementTags(db as never, 'gcs-agreement-tags', '44', ['capacity-building'])).resolves.toEqual({
      id: 'existing',
      value: ['capacity-building']
    })
    expect(db.insertInto).toHaveBeenCalledWith('extensions.kv_entry')
    expect(db.updateTable).toHaveBeenCalledWith('extensions.kv_entry')
  })

  it('ships local model files and a bundled worker that does not rely on remote models', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const workerSource = await readFile(resolve(root, 'client/worker-source.js'), 'utf8')
    const bundledWorker = await readFile(resolve(root, 'client/worker.js'), 'utf8')
    const config = await readFile(resolve(root, 'models/Xenova/all-MiniLM-L6-v2/config.json'), 'utf8')

    expect(workerSource).toContain('allowRemoteModels = false')
    expect(workerSource).toContain('Xenova/all-MiniLM-L6-v2')
    expect(bundledWorker).toContain('Xenova/all-MiniLM-L6-v2')
    expect(JSON.parse(config).model_type).toBe('bert')
  })
})
