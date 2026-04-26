/* eslint-disable jsdoc/require-jsdoc */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import extensionDefinition from '../../extension.config'
import getTagsHandler from '../../server/api/extensions/gcs-agreement-tags/streams/[streamId]/agreements/[agreementId]/tags.get'
import patchTagsHandler from '../../server/api/extensions/gcs-agreement-tags/streams/[streamId]/agreements/[agreementId]/tags.patch'
import {
  normalizeAgreementTagsConfig,
  normalizeAgreementTagValues,
  rankTagsByKeywordOverlap,
  resolveAgreementTagsDescriptionsContext,
  toAgreementTagsJson
} from '../../components/agreement-tags'
import {
  getPersistedAgreementTags,
  resolveAgreementTagsRouteContext,
  setPersistedAgreementTags,
  validateRequestedTags
} from '../../server/agreement-tags-route'

const readBodyMock = vi.hoisted(() => vi.fn())

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3')

  return {
    ...actual,
    readBody: (...args: unknown[]) => readBodyMock(...args)
  }
})

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
    expect(extensionDefinition.client?.slots?.map(slot => slot.slot)).toEqual(['agreement.descriptions.after'])
    expect(extensionDefinition.nitroPlugin).toBe('./server/nitro-plugin.ts')
    expect(extensionDefinition.assets).toEqual([
      {
        path: './client',
        baseURL: '/extensions/gcs-agreement-tags/client'
      },
      {
        package: '@browser-tag-extractor/core',
        packagePath: 'models',
        baseURL: '/extensions/gcs-agreement-tags/models'
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
    expect(config.allowCustomTags).toBe(false)
    expect(config.allowDynamicTagSuggestions).toBe(false)
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

  it('resolves shared agreement descriptions contexts with English and French text', () => {
    expect(resolveAgreementTagsDescriptionsContext({
      kind: 'agreement.descriptions',
      descriptions: {
        en: ' Infrastructure project ',
        fr: ' Projet '
      },
      streamId: '31',
      agreementId: '44'
    })).toEqual({
      kind: 'agreement.descriptions',
      descriptions: {
        en: 'Infrastructure project',
        fr: 'Projet'
      },
      streamId: '31',
      agreementId: '44',
      extensions: {},
      setExtensionPayload: undefined
    })

    expect(resolveAgreementTagsDescriptionsContext({
      textarea: {
        kind: 'agreement.description',
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

    expect(ranked.flatMap(item => item.predefined ? [item.key] : [])).toContain('infrastructure')
    expect(ranked.every(item => item.predefined && config.tags.some(tag => tag.key === item.key))).toBe(true)
  })

  it('suggests capacity building for the training regression sentence', () => {
    const config = normalizeAgreementTagsConfig({})
    const ranked = rankTagsByKeywordOverlap(
      'We are looking to increase the trainers ability to perform tasks by providing them training',
      config.tags,
      2
    )

    expect(ranked[0]?.predefined ? ranked[0].key : '').toBe('capacity-building')
  })

  it('validates persisted tags against stream configuration', () => {
    const config = normalizeAgreementTagsConfig({})

    expect(validateRequestedTags(config, [' infrastructure '])).toEqual([{
      predefined: true,
      key: 'infrastructure',
      label: 'Infrastructure'
    }])
    expect(validateRequestedTags(config, ['infrastructure', 'infrastructure'])).toBeNull()
    expect(validateRequestedTags(config, ['invented-tag'])).toBeNull()
    expect(validateRequestedTags(config, ['infrastructure', 'capacity-building', 'community-benefit', 'extra'])).toBeNull()
    expect(validateRequestedTags(config, 'infrastructure')).toBeNull()
  })

  it('validates predefined and custom agreement-level typed tags', () => {
    const config = normalizeAgreementTagsConfig({ allowCustomTags: true })

    expect(normalizeAgreementTagValues(config, [
      { predefined: true, key: 'capacity-building', label: 'ignored client label' },
      { predefined: false, label: ' Local priority ' }
    ])).toEqual([
      {
        predefined: true,
        key: 'capacity-building',
        label: 'Capacity building'
      },
      {
        predefined: false,
        label: 'Local priority'
      }
    ])
  })

  it('resolves route context only for this extension and authorized agreement stream pairs', async () => {
    const agreementQuery = createQueryChain({
      agreement_id: '44',
      stream_id: '31',
      profile_id: '22',
      agency_id: '1'
    })
    const configQuery = createQueryChain({
      enabled: true,
      config: {
        enabled: true
      }
    })
    const db = {
      selectFrom: vi.fn()
        .mockReturnValueOnce(agreementQuery)
        .mockReturnValueOnce(configQuery)
    }
    const authContext = {
      userId: 'user-1',
      userAbilities: {
        authorizeWithTeam: vi.fn(async () => false),
        authorize: vi.fn(() => true)
      }
    }

    await expect(resolveAgreementTagsRouteContext({
      context: {
        $db: db,
        $authContext: authContext,
        params: {
          extensionKey: 'gcs-agreement-tags',
          streamId: '31',
          agreementId: '44'
        }
      }
    } as never, 'read')).resolves.toMatchObject({
      extensionKey: 'gcs-agreement-tags',
      streamId: '31',
      agreementId: '44',
      agencyId: '1',
      profileId: '22'
    })
    expect(authContext.userAbilities.authorizeWithTeam).toHaveBeenCalledWith(
      'agreement',
      'read',
      expect.objectContaining({
        path: expect.arrayContaining([{ type: 'fundingcaseagreement', id: '44' }])
      }),
      'user-1',
      true,
      db
    )
  })

  it('throws instead of returning pretend success objects for invalid extension routes', async () => {
    const db = {
      selectFrom: vi.fn()
    }

    await expect(resolveAgreementTagsRouteContext({
      context: {
        $db: db,
        $authContext: {},
        params: {
          extensionKey: 'other-extension',
          streamId: '31',
          agreementId: '44'
        }
      }
    } as never, 'read')).rejects.toMatchObject({
      statusCode: 404,
      data: {
        code: 'EXTENSION_NOT_FOUND'
      }
    })
    expect(db.selectFrom).not.toHaveBeenCalled()
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
      { predefined: true, key: 'infrastructure', label: 'infrastructure' },
      { predefined: true, key: 'community-benefit', label: 'community-benefit' }
    ])
    await expect(setPersistedAgreementTags(db as never, 'gcs-agreement-tags', '44', [{ predefined: true, key: 'infrastructure', label: 'Infrastructure' }])).resolves.toEqual({ id: 'created' })
    await expect(setPersistedAgreementTags(db as never, 'gcs-agreement-tags', '44', [{ predefined: true, key: 'capacity-building', label: 'Capacity building' }])).resolves.toEqual({
      id: 'existing',
      value: ['capacity-building']
    })
    expect(db.insertInto).toHaveBeenCalledWith('extensions.kv_entry')
    expect(db.updateTable).toHaveBeenCalledWith('extensions.kv_entry')
  })

  it('filters persisted tags in the get route and rejects invalid patch route payloads', async () => {
    const agreementQuery = createQueryChain({
      agreement_id: '44',
      stream_id: '31',
      profile_id: '22',
      agency_id: '1'
    })
    const configQuery = createQueryChain({
      enabled: true,
      config: {
        enabled: true,
        tags: [{
          key: 'infrastructure',
          label: { en: 'Infrastructure', fr: 'Infrastructure' },
          description: { en: '', fr: '' },
          aliases: [],
          color: 'neutral'
        }]
      }
    })
    const tagsQuery = createQueryChain({
      value: ['infrastructure', 'deleted-tag']
    })
    const event = {
      context: {
        $db: {
          selectFrom: vi.fn()
            .mockReturnValueOnce(agreementQuery)
            .mockReturnValueOnce(configQuery)
            .mockReturnValueOnce(tagsQuery)
            .mockReturnValueOnce(agreementQuery)
            .mockReturnValueOnce(configQuery)
        },
        $authContext: {
          userId: 'user-1',
          userAbilities: {
            authorizeWithTeam: vi.fn(async () => true),
            authorize: vi.fn(() => false)
          }
        },
        params: {
          extensionKey: 'gcs-agreement-tags',
          streamId: '31',
          agreementId: '44'
        }
      }
    }

    await expect(getTagsHandler(event as never)).resolves.toEqual({
      tags: [{ predefined: true, key: 'infrastructure', label: 'infrastructure' }]
    })

    readBodyMock.mockResolvedValueOnce({
      tags: ['deleted-tag']
    })
    await expect(patchTagsHandler(event as never)).rejects.toMatchObject({
      statusCode: 400,
      data: {
        code: 'INVALID_TAGS'
      }
    })
  })

  it('persists agreement update hook tags from the raw extension payload', async () => {
    let registeredHook: ((payload: {
      event: {
        context: {
          $db: unknown
        }
      }
      agreementId: string
      streamId: string
      rawBody: Record<string, unknown>
    }) => Promise<void>) | undefined
    vi.stubGlobal('defineNitroPlugin', (callback: (nitroApp: { hooks: { hook: (name: string, handler: typeof registeredHook) => void } }) => void) => callback({
      hooks: {
        hook: (name, handler) => {
          if (name === 'agreement:profile:updated') {
            registeredHook = handler
          }
        }
      }
    }))
    vi.stubGlobal('createError', (value: unknown) => value)

    const configQuery = createQueryChain({
      enabled: true,
      config: {
        enabled: true
      }
    })
    const missingQuery = createQueryChain()
    const insertedValues: unknown[] = []
    const insertQuery = {
      values: vi.fn((value: unknown) => {
        insertedValues.push(value)
        return insertQuery
      }),
      returningAll: vi.fn(() => insertQuery),
      executeTakeFirst: vi.fn(async () => ({ id: 'kv-1' }))
    }
    const db = {
      selectFrom: vi.fn()
        .mockReturnValueOnce(configQuery)
        .mockReturnValueOnce(missingQuery),
      insertInto: vi.fn(() => insertQuery),
      updateTable: vi.fn()
    }

    await import('../../server/nitro-plugin')
    await registeredHook?.({
      event: {
        context: {
          $db: db
        }
      },
      agreementId: '44',
      streamId: '31',
      rawBody: {
        extensions: {
          'gcs-agreement-tags': {
            agreementDescriptionTags: [
              { predefined: true, key: 'capacity-building', label: 'Capacity building' }
            ]
          }
        }
      }
    })

    expect(db.insertInto).toHaveBeenCalledWith('extensions.kv_entry')
    expect(insertedValues[0]).toEqual(expect.objectContaining({
      extension_key: 'gcs-agreement-tags',
      owner_type: 'fundingcaseagreement',
      owner_id: '44',
      value: [
        { predefined: true, key: 'capacity-building', label: 'Capacity building' }
      ]
    }))
  })

  it('uses the tag extractor package model assets and a bundled worker configured for local model loading', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const workerSource = await readFile(resolve(root, 'client/worker-source.js'), 'utf8')
    const bundledWorker = await readFile(resolve(root, 'client/worker.js'), 'utf8')
    const wasmRuntime = await readFile(resolve(root, 'client/ort-wasm-simd-threaded.asyncify.mjs'), 'utf8')
    const packageConfig = await readFile(resolve(root, 'node_modules/@browser-tag-extractor/core/models/Xenova/all-MiniLM-L12-v2/config.json'), 'utf8')

    expect(workerSource).toContain('@browser-tag-extractor/core/benchmark')
    expect(workerSource).toContain('/extensions/gcs-agreement-tags/models/')
    expect(bundledWorker).toContain('Xenova/all-MiniLM-L12-v2')
    expect(wasmRuntime).toContain('ort-wasm-simd-threaded.asyncify.wasm')
    expect(JSON.parse(packageConfig).model_type).toBe('bert')
  })
})
