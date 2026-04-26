/* eslint-disable jsdoc/require-jsdoc */
import { GCS_TEXTAREA_TARGETS } from '@gcs-ssc/extensions'
import type { GcsTextareaKnownTargetKey, JsonValue } from '@gcs-ssc/extensions'

export type AgreementTagLocale = 'en' | 'fr'

export interface AgreementTagDefinition {
  key: string
  label: Record<AgreementTagLocale, string>
  description: Record<AgreementTagLocale, string>
  aliases: string[]
  color: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
}

export interface AgreementTagsConfig {
  enabled: boolean
  targets: Record<GcsTextareaKnownTargetKey, boolean>
  allowCustomTags: boolean
  allowDynamicTagSuggestions: boolean
  minScore: number
  maxSuggestions: number
  minDynamicScore: number
  maxDynamicTags: number
  dynamicNgramMin: number
  dynamicNgramMax: number
  semanticWeight: number
  lexicalWeight: number
  exactAliasBoost: number
  negationPenalty: number
  negationWindow: number
  useEmbeddingCache: boolean
  useBrowserCache: boolean
  tags: AgreementTagDefinition[]
}

export type AgreementTagValue =
  | {
    predefined: true
    key: string
    label: string
  }
  | {
    predefined: false
    label: string
  }

export interface AgreementTagsDescriptionsContext {
  kind: 'agreement.descriptions' | 'proponent.descriptions'
  descriptions?: {
    en?: string
    fr?: string
  }
  streamId?: string
  agreementId?: string
  agencyId?: string
  applicantRecipientId?: string
  extensions: Record<string, Record<string, unknown>>
  setExtensionPayload?: (extensionKey: string, payloadKey: string, value: unknown) => void
}

export interface AgreementTagsContext {
  kind?: string
  descriptions?: {
    en?: string
    fr?: string
  }
  streamId?: string
  agreementId?: string
  agencyId?: string
  applicantRecipientId?: string
  extensions?: Record<string, Record<string, unknown>>
  setExtensionPayload?: (extensionKey: string, payloadKey: string, value: unknown) => void
}

export interface AgreementTagsEntityTarget {
  targetKey: GcsTextareaKnownTargetKey
  label: string
  text: string
  streamId?: string
  agencyId?: string
  ownerType?: string
  ownerId?: string
  extensions: Record<string, Record<string, unknown>>
  setExtensionPayload?: (extensionKey: string, payloadKey: string, value: unknown) => void
}

export type AgreementTagSuggestion =
  | {
    predefined: true
    key: string
    score: number
  }
  | {
    predefined: false
    label: string
    score: number
  }

export const AGREEMENT_TAG_COLORS: AgreementTagDefinition['color'][] = [
  'primary',
  'secondary',
  'success',
  'info',
  'warning',
  'error',
  'neutral'
]

export const DEFAULT_AGREEMENT_TAGS: AgreementTagDefinition[] = [
  {
    key: 'community-benefit',
    label: {
      en: 'Community benefit',
      fr: 'Avantage communautaire'
    },
    description: {
      en: 'The agreement describes direct benefits for communities or public users.',
      fr: 'L’entente décrit des avantages directs pour les collectivités ou les utilisateurs publics.'
    },
    aliases: ['community impact', 'public benefit', 'local benefit'],
    color: 'success'
  },
  {
    key: 'capacity-building',
    label: {
      en: 'Capacity building',
      fr: 'Renforcement des capacités'
    },
    description: {
      en: 'The agreement supports skills, training, operations, tools, or organizational capacity.',
      fr: 'L’entente appuie les compétences, la formation, les opérations, les outils ou la capacité organisationnelle.'
    },
    aliases: ['training', 'skills', 'organizational capacity'],
    color: 'info'
  },
  {
    key: 'infrastructure',
    label: {
      en: 'Infrastructure',
      fr: 'Infrastructure'
    },
    description: {
      en: 'The agreement involves construction, equipment, facilities, or capital assets.',
      fr: 'L’entente vise la construction, l’équipement, les installations ou les immobilisations.'
    },
    aliases: ['capital project', 'equipment', 'facility'],
    color: 'neutral'
  }
]

const DEFAULT_CONFIG: AgreementTagsConfig = {
  enabled: true,
  targets: {
    'agreement.description': true,
    'proponent.description': true
  },
  allowCustomTags: false,
  allowDynamicTagSuggestions: false,
  minScore: 0.36,
  maxSuggestions: 4,
  minDynamicScore: 0.34,
  maxDynamicTags: 4,
  dynamicNgramMin: 1,
  dynamicNgramMax: 3,
  semanticWeight: 0.75,
  lexicalWeight: 0.25,
  exactAliasBoost: 0.45,
  negationPenalty: 0.45,
  negationWindow: 6,
  useEmbeddingCache: true,
  useBrowserCache: true,
  tags: DEFAULT_AGREEMENT_TAGS
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

const asBoolean = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback

const asNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, numericValue))
}

export const normalizeAgreementTagKey = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const normalizeLabel = (value: unknown, fallback: Record<AgreementTagLocale, string>): Record<AgreementTagLocale, string> => {
  const record = isRecord(value) ? value : {}
  return {
    en: asString(record.en, fallback.en).trim(),
    fr: asString(record.fr, fallback.fr).trim()
  }
}

const normalizeAliases = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(new Set(value.map(item => asString(item).trim()).filter(item => item.length > 0)))
}

const normalizeColor = (value: unknown, fallback: AgreementTagDefinition['color']): AgreementTagDefinition['color'] =>
  AGREEMENT_TAG_COLORS.includes(value as AgreementTagDefinition['color'])
    ? value as AgreementTagDefinition['color']
    : fallback

const normalizeTargets = (value: unknown): Record<GcsTextareaKnownTargetKey, boolean> => {
  const record = isRecord(value) ? value : {}
  return GCS_TEXTAREA_TARGETS.reduce<Record<GcsTextareaKnownTargetKey, boolean>>((acc, target) => {
    acc[target.key] = asBoolean(record[target.key], DEFAULT_CONFIG.targets[target.key])
    return acc
  }, {
    'agreement.description': DEFAULT_CONFIG.targets['agreement.description'],
    'proponent.description': DEFAULT_CONFIG.targets['proponent.description']
  })
}

const normalizeTag = (value: unknown, fallback: AgreementTagDefinition, index: number): AgreementTagDefinition | null => {
  const record = isRecord(value) ? value : {}
  const key = normalizeAgreementTagKey(asString(record.key, fallback.key || `tag-${index + 1}`))
  const label = normalizeLabel(record.label, fallback.label)
  const description = normalizeLabel(record.description, fallback.description)

  if (!key || !label.en || !label.fr) {
    return null
  }

  return {
    key,
    label,
    description,
    aliases: normalizeAliases(record.aliases),
    color: normalizeColor(record.color, fallback.color)
  }
}

export const normalizeAgreementTagsConfig = (value: unknown): AgreementTagsConfig => {
  const record = isRecord(value) ? value : {}
  const rawTags = Array.isArray(record.tags) ? record.tags : DEFAULT_CONFIG.tags
  const dynamicNgramMin = Math.round(asNumber(record.dynamicNgramMin, DEFAULT_CONFIG.dynamicNgramMin, 1, 5))
  const dynamicNgramMax = Math.round(asNumber(record.dynamicNgramMax, DEFAULT_CONFIG.dynamicNgramMax, 1, 5))
  const minDynamicNgram = Math.min(dynamicNgramMin, dynamicNgramMax)
  const maxDynamicNgram = Math.max(dynamicNgramMin, dynamicNgramMax)
  const seenKeys = new Set<string>()
  const tags = rawTags.flatMap((item, index) => {
    const fallback = DEFAULT_CONFIG.tags[index] ?? {
      key: `tag-${index + 1}`,
      label: { en: `Tag ${index + 1}`, fr: `Étiquette ${index + 1}` },
      description: { en: '', fr: '' },
      aliases: [],
      color: 'neutral' as const
    }
    const normalized = normalizeTag(item, fallback, index)
    if (!normalized || seenKeys.has(normalized.key)) {
      return []
    }

    seenKeys.add(normalized.key)
    return [normalized]
  })

  return {
    enabled: asBoolean(record.enabled, DEFAULT_CONFIG.enabled),
    targets: normalizeTargets(record.targets),
    allowCustomTags: asBoolean(record.allowCustomTags, DEFAULT_CONFIG.allowCustomTags),
    allowDynamicTagSuggestions: asBoolean(record.allowDynamicTagSuggestions, DEFAULT_CONFIG.allowDynamicTagSuggestions),
    minScore: asNumber(record.minScore, DEFAULT_CONFIG.minScore, 0, 1),
    maxSuggestions: Math.round(asNumber(record.maxSuggestions, DEFAULT_CONFIG.maxSuggestions, 1, 12)),
    minDynamicScore: asNumber(record.minDynamicScore, DEFAULT_CONFIG.minDynamicScore, 0, 1),
    maxDynamicTags: Math.round(asNumber(record.maxDynamicTags, DEFAULT_CONFIG.maxDynamicTags, 1, 12)),
    dynamicNgramMin: minDynamicNgram,
    dynamicNgramMax: maxDynamicNgram,
    semanticWeight: asNumber(record.semanticWeight, DEFAULT_CONFIG.semanticWeight, 0, 1),
    lexicalWeight: asNumber(record.lexicalWeight, DEFAULT_CONFIG.lexicalWeight, 0, 1),
    exactAliasBoost: asNumber(record.exactAliasBoost, DEFAULT_CONFIG.exactAliasBoost, 0, 1),
    negationPenalty: asNumber(record.negationPenalty, DEFAULT_CONFIG.negationPenalty, 0, 1),
    negationWindow: Math.round(asNumber(record.negationWindow, DEFAULT_CONFIG.negationWindow, 0, 20)),
    useEmbeddingCache: asBoolean(record.useEmbeddingCache, DEFAULT_CONFIG.useEmbeddingCache),
    useBrowserCache: asBoolean(record.useBrowserCache, DEFAULT_CONFIG.useBrowserCache),
    tags: tags.length > 0 ? tags : DEFAULT_CONFIG.tags.map(tag => ({ ...tag, label: { ...tag.label }, description: { ...tag.description }, aliases: [...tag.aliases] }))
  }
}

export const toAgreementTagsJson = (config: AgreementTagsConfig): Record<string, JsonValue> => ({
  enabled: config.enabled,
  targets: config.targets,
  allowCustomTags: config.allowCustomTags,
  allowDynamicTagSuggestions: config.allowDynamicTagSuggestions,
  minScore: config.minScore,
  maxSuggestions: config.maxSuggestions,
  minDynamicScore: config.minDynamicScore,
  maxDynamicTags: config.maxDynamicTags,
  dynamicNgramMin: config.dynamicNgramMin,
  dynamicNgramMax: config.dynamicNgramMax,
  semanticWeight: config.semanticWeight,
  lexicalWeight: config.lexicalWeight,
  exactAliasBoost: config.exactAliasBoost,
  negationPenalty: config.negationPenalty,
  negationWindow: config.negationWindow,
  useEmbeddingCache: config.useEmbeddingCache,
  useBrowserCache: config.useBrowserCache,
  tags: config.tags.map(tag => ({
    key: tag.key,
    label: tag.label,
    description: tag.description,
    aliases: tag.aliases,
    color: tag.color
  }))
})

const combinedDescriptionText = (descriptions: { en?: string; fr?: string }) => [
  asString(descriptions.en).trim(),
  asString(descriptions.fr).trim()
].filter(item => item.length > 0).join('\n\n')

export const resolveAgreementTagsDescriptionsContext = (context: Record<string, unknown>): AgreementTagsDescriptionsContext | null => {
  if (context.kind !== 'agreement.descriptions' && context.kind !== 'proponent.descriptions') {
    return null
  }
  const descriptions = isRecord(context.descriptions) ? context.descriptions : {}
  const extensions = isRecord(context.extensions) ? context.extensions as Record<string, Record<string, unknown>> : {}
  const setExtensionPayload = typeof context.setExtensionPayload === 'function'
    ? context.setExtensionPayload as AgreementTagsDescriptionsContext['setExtensionPayload']
    : undefined

  return {
    kind: context.kind,
    descriptions: {
      en: asString(descriptions.en).trim(),
      fr: asString(descriptions.fr).trim()
    },
    streamId: asString(context.streamId),
    agreementId: asString(context.agreementId),
    agencyId: asString(context.agencyId),
    applicantRecipientId: asString(context.applicantRecipientId || context.proponentId || context.ownerId),
    extensions,
    setExtensionPayload
  }
}

export const resolveAgreementTagsTextareaContext = resolveAgreementTagsDescriptionsContext

export const resolveAgreementTagsEntityTarget = (context: Record<string, unknown>): AgreementTagsEntityTarget | null => {
  const descriptionsContext = resolveAgreementTagsDescriptionsContext(context)
  if (!descriptionsContext?.descriptions) {
    return null
  }

  const text = combinedDescriptionText(descriptionsContext.descriptions)
  if (!text) {
    return null
  }

  if (descriptionsContext.kind === 'agreement.descriptions') {
    return {
      targetKey: 'agreement.description',
      label: 'Agreement descriptions',
      text,
      streamId: descriptionsContext.streamId,
      ownerType: 'fundingcaseagreement',
      ownerId: descriptionsContext.agreementId,
      extensions: descriptionsContext.extensions,
      setExtensionPayload: descriptionsContext.setExtensionPayload
    }
  }

  return {
    targetKey: 'proponent.description',
    label: 'Proponent descriptions',
    text,
    agencyId: descriptionsContext.agencyId,
    ownerType: 'applicantrecipient',
    ownerId: descriptionsContext.applicantRecipientId,
    extensions: descriptionsContext.extensions,
    setExtensionPayload: descriptionsContext.setExtensionPayload
  }
}

export const buildTagEmbeddingText = (tag: AgreementTagDefinition): string => [
  tag.label.en,
  tag.description.en,
  ...tag.aliases
].map(item => item.trim()).filter(item => item.length > 0).join('. ')

const tokenize = (value: string): string[] => value
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(token => token.length > 2)

export const rankTagsByKeywordOverlap = (
  text: string,
  tags: AgreementTagDefinition[],
  maxSuggestions: number
): AgreementTagSuggestion[] => {
  const textTokens = new Set(tokenize(text))
  if (textTokens.size === 0) {
    return []
  }

  return tags
    .map(tag => {
      const tagTokens = new Set(tokenize(buildTagEmbeddingText(tag)))
      const hits = Array.from(tagTokens).filter(token => textTokens.has(token)).length
      const aliasHits = tag.aliases
        .map(alias => tokenize(alias))
        .filter(aliasTokens => aliasTokens.length > 0 && aliasTokens.every(token => textTokens.has(token))).length
      const boost = aliasHits > 0 ? 0.45 : 0
      return {
        predefined: true as const,
        key: tag.key,
        score: Math.min(1, (tagTokens.size > 0 ? hits / tagTokens.size : 0) + boost)
      }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
}

export const validTagKeys = (config: AgreementTagsConfig): Set<string> =>
  new Set(config.tags.map(tag => tag.key))

const normalizeCustomLabel = (value: string): string => value.trim().replace(/\s+/g, ' ')

export const tagValueKey = (tag: AgreementTagValue): string =>
  tag.predefined ? `predefined:${tag.key}` : `custom:${normalizeAgreementTagKey(tag.label)}`

export const makePredefinedTagValue = (
  tag: AgreementTagDefinition,
  locale: AgreementTagLocale
): AgreementTagValue => ({
  predefined: true,
  key: tag.key,
  label: locale === 'fr' ? tag.label.fr : tag.label.en
})

export const normalizeAgreementTagValues = (
  config: AgreementTagsConfig,
  tags: unknown,
  locale: AgreementTagLocale = 'en'
): AgreementTagValue[] | null => {
  if (!Array.isArray(tags)) {
    return null
  }

  const allowedTags = new Map(config.tags.map(tag => [tag.key, tag]))
  const seenKeys = new Set<string>()
  const normalized: AgreementTagValue[] = []

  for (const item of tags) {
    if (typeof item === 'string') {
      const key = item.trim()
      const tag = allowedTags.get(key)
      if (!tag) {
        return null
      }
      const value = makePredefinedTagValue(tag, locale)
      const uniqueKey = tagValueKey(value)
      if (seenKeys.has(uniqueKey)) {
        return null
      }
      seenKeys.add(uniqueKey)
      normalized.push(value)
      continue
    }

    if (!isRecord(item) || typeof item.predefined !== 'boolean') {
      return null
    }

    if (item.predefined) {
      const key = asString(item.key).trim()
      const tag = allowedTags.get(key)
      if (!tag) {
        return null
      }
      const value = makePredefinedTagValue(tag, locale)
      const uniqueKey = tagValueKey(value)
      if (seenKeys.has(uniqueKey)) {
        return null
      }
      seenKeys.add(uniqueKey)
      normalized.push(value)
      continue
    }

    if (!config.allowCustomTags) {
      return null
    }

    const label = normalizeCustomLabel(asString(item.label))
    if (!label || label.length > 80) {
      return null
    }

    const value: AgreementTagValue = {
      predefined: false,
      label
    }
    const uniqueKey = tagValueKey(value)
    if (seenKeys.has(uniqueKey)) {
      return null
    }
    seenKeys.add(uniqueKey)
    normalized.push(value)
  }

  return normalized
}
