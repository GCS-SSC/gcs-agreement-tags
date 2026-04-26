/* eslint-disable jsdoc/require-jsdoc */
import type { JsonValue } from '@gcs-ssc/extensions'
import type { GcsTextareaKnownTargetKey } from '@gcs-ssc/extensions'
import { createError } from 'h3'
import {
  normalizeNarrativeTagSource,
  normalizeNarrativeTagsConfig,
  normalizeNarrativeTagValues,
  sameNarrativeTagSource
} from '../components/narrative-tags'
import type { NarrativeTagSource, NarrativeTagSourceConfig, NarrativeTagValue } from '../components/narrative-tags'

export const NARRATIVE_TAGS_EXTENSION_KEY = 'gcs-narrative-tags'
export const NARRATIVE_TAGS_OWNER_TYPE = 'fundingcaseagreement'
export const NARRATIVE_TAGS_PROPONENT_OWNER_TYPE = 'applicantrecipient'
export const NARRATIVE_TAGS_CONFIG_KEY = 'agreement-description-tags'
export const NARRATIVE_TAGS_TEXT_FIELD_CONFIG_KEY = 'text-field-tags'

interface QueryChain {
  innerJoin: (...args: unknown[]) => QueryChain
  leftJoin: (...args: unknown[]) => QueryChain
  select: (...args: unknown[]) => QueryChain
  where: (...args: unknown[]) => QueryChain
  distinct: (...args: unknown[]) => QueryChain
  execute: () => Promise<Array<Record<string, unknown>>>
  executeTakeFirst: () => Promise<Record<string, unknown> | undefined>
}

interface JoinChain {
  onRef: (...args: unknown[]) => JoinChain
  on: (...args: unknown[]) => JoinChain
}

interface MutationChain {
  values: (...args: unknown[]) => MutationChain
  set: (...args: unknown[]) => MutationChain
  where: (...args: unknown[]) => MutationChain
  returningAll: () => MutationChain
  executeTakeFirst: () => Promise<Record<string, unknown> | undefined>
}

export interface NarrativeTagsRouteDatabase {
  selectFrom: (table: string) => QueryChain
  insertInto: (table: string) => MutationChain
  updateTable: (table: string) => MutationChain
}

export interface NarrativeTagsRouteContext {
  extensionKey: typeof NARRATIVE_TAGS_EXTENSION_KEY
  streamId: string
  agreementId: string
  agencyId: string
  profileId: string
  scope: {
    type: 'entity'
    agencyId: string
    path: Array<{
      type: string
      id: string
    }>
  }
  config: ReturnType<typeof normalizeNarrativeTagsConfig>
}

interface NarrativeTagsRouteEvent {
  context: {
    $db: unknown
    $authContext?: {
      userId: string
      userAbilities: {
        authorizeWithTeam: (
          resource: string,
          action: string,
          scope: NarrativeTagsRouteContext['scope'],
          userId: string,
          includeTeams: boolean,
          db: NarrativeTagsRouteDatabase
        ) => Promise<boolean>
        authorize: (
          resource: string,
          action: string,
          scope: NarrativeTagsRouteContext['scope']
        ) => boolean
      }
    }
    params?: {
      extensionKey?: string
      streamId?: string
      agreementId?: string
    }
  }
}

export const createExtensionRouteErrorResponse = (
  statusCode: number,
  code: string,
  message: string
): never => {
  throw createError({
    statusCode,
    message,
    data: {
      message,
      code
    }
  })
}

const buildAgreementScope = (
  agencyId: string,
  profileId: string,
  streamId: string,
  agreementId: string
): NarrativeTagsRouteContext['scope'] => ({
  type: 'entity',
  agencyId,
  path: [
    { type: 'transfer_payment', id: profileId },
    { type: 'transfer_payment_stream', id: streamId },
    { type: 'fundingcaseagreement', id: agreementId }
  ]
})

const resolveAgreementContext = async (
  db: NarrativeTagsRouteDatabase,
  streamId: string,
  agreementId: string
) => {
  const row = await db
    .selectFrom('Funding_Case_Agreement_Profile')
    .innerJoin(
      'Transfer_Payment_Stream',
      'Transfer_Payment_Stream.id',
      'Funding_Case_Agreement_Profile.egcs_fc_transferpaymentstream'
    )
    .innerJoin(
      'Transfer_Payment_Profile',
      'Transfer_Payment_Profile.id',
      'Transfer_Payment_Stream.egcs_tp_transferpaymentprofile'
    )
    .select([
      'Funding_Case_Agreement_Profile.id as agreement_id',
      'Funding_Case_Agreement_Profile.egcs_fc_transferpaymentstream as stream_id',
      'Transfer_Payment_Profile.id as profile_id',
      'Transfer_Payment_Profile.egcs_tp_agency as agency_id'
    ])
    .where('Funding_Case_Agreement_Profile.id', '=', agreementId)
    .where('Funding_Case_Agreement_Profile.egcs_fc_transferpaymentstream', '=', streamId)
    .where('Funding_Case_Agreement_Profile._deleted', '=', false)
    .where('Transfer_Payment_Stream._deleted', '=', false)
    .where('Transfer_Payment_Profile._deleted', '=', false)
    .executeTakeFirst()

  if (!row?.agreement_id || !row.stream_id || !row.profile_id || !row.agency_id) {
    return null
  }

  return {
    agencyId: String(row.agency_id),
    profileId: String(row.profile_id),
    streamId: String(row.stream_id),
    agreementId: String(row.agreement_id)
  }
}

const getStreamConfiguration = async (
  db: NarrativeTagsRouteDatabase,
  extensionKey: string,
  streamId: string
) => {
  const row = await db
    .selectFrom('extensions.stream_configuration')
    .select(['enabled', 'config'])
    .where('extension_key', '=', extensionKey)
    .where('stream_id', '=', streamId)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  return {
    enabled: row?.enabled === true,
    config: normalizeNarrativeTagsConfig(row?.config)
  }
}

export const resolveNarrativeTagsRouteContext = async (
  event: NarrativeTagsRouteEvent,
  action: 'read' | 'update'
): Promise<NarrativeTagsRouteContext> => {
  const db = event.context.$db as NarrativeTagsRouteDatabase
  const extensionKey = event.context.params?.extensionKey
  const streamId = event.context.params?.streamId
  const agreementId = event.context.params?.agreementId

  if (typeof extensionKey !== 'string' || typeof streamId !== 'string' || typeof agreementId !== 'string') {
    return createExtensionRouteErrorResponse(400, 'MISSING_ID', 'Missing extension route identifiers.')
  }
  const resolvedStreamId = streamId
  const resolvedAgreementId = agreementId

  if (extensionKey !== NARRATIVE_TAGS_EXTENSION_KEY) {
    return createExtensionRouteErrorResponse(404, 'EXTENSION_NOT_FOUND', 'Extension not found.')
  }

  const agreement = await resolveAgreementContext(db, resolvedStreamId, resolvedAgreementId)
  if (!agreement) {
    return createExtensionRouteErrorResponse(404, 'AGREEMENT_NOT_FOUND', 'Agreement not found.')
  }
  const resolvedAgreement = agreement

  const streamConfig = await getStreamConfiguration(db, NARRATIVE_TAGS_EXTENSION_KEY, resolvedStreamId)
  if (!streamConfig.enabled) {
    return createExtensionRouteErrorResponse(403, 'EXTENSION_STREAM_DISABLED', 'Extension is disabled for this stream.')
  }

  const authContext = event.context.$authContext
  if (!authContext) {
    return createExtensionRouteErrorResponse(401, 'AUTH_UNAUTHORIZED', 'Unauthorized.')
  }

  const scope = buildAgreementScope(
    resolvedAgreement.agencyId,
    resolvedAgreement.profileId,
    resolvedAgreement.streamId,
    resolvedAgreement.agreementId
  )
  const canAccessWithTeam = await authContext.userAbilities.authorizeWithTeam(
    'agreement',
    action,
    scope,
    authContext.userId,
    true,
    db
  )
  const canAccessScope = authContext.userAbilities.authorize('agreement', action, scope)

  if (!canAccessWithTeam && !canAccessScope) {
    return createExtensionRouteErrorResponse(403, 'AUTH_FORBIDDEN', 'Forbidden.')
  }

  return {
    extensionKey: NARRATIVE_TAGS_EXTENSION_KEY,
    streamId: resolvedStreamId,
    agreementId: resolvedAgreementId,
    agencyId: resolvedAgreement.agencyId,
    profileId: resolvedAgreement.profileId,
    scope,
    config: streamConfig.config
  }
}

const normalizeSourceName = (
  en: unknown,
  fr: unknown,
  fallback: string
): NarrativeTagSource['agencyName'] => ({
  en: typeof en === 'string' && en.trim() ? en.trim() : fallback,
  fr: typeof fr === 'string' && fr.trim() ? fr.trim() : fallback
})

export const resolveProponentNarrativeTagSources = async (
  db: NarrativeTagsRouteDatabase,
  extensionKey: string,
  leadAgencyId: string,
  applicantRecipientId: string
): Promise<NarrativeTagSourceConfig[]> => {
  const profile = await db
    .selectFrom('Applicant_Recipient_Profile')
    .leftJoin('Agency_Profile', 'Agency_Profile.id', 'Applicant_Recipient_Profile.egcs_ar_leadagency')
    .select([
      'Applicant_Recipient_Profile.id as applicant_recipient_id',
      'Applicant_Recipient_Profile.egcs_ar_leadagency as lead_agency_id',
      'Agency_Profile.egcs_ay_name_en as agency_name_en',
      'Agency_Profile.egcs_ay_name_fr as agency_name_fr'
    ])
    .where('Applicant_Recipient_Profile.id', '=', applicantRecipientId)
    .where('Applicant_Recipient_Profile.egcs_ar_leadagency', '=', leadAgencyId)
    .where('Applicant_Recipient_Profile._deleted', '=', false)
    .executeTakeFirst()

  if (!profile) {
    return []
  }

  const sources: NarrativeTagSourceConfig[] = []
  const leadAgencyEnabled = await db
    .selectFrom('extensions.agency_enablement')
    .select('enabled')
    .where('extension_key', '=', extensionKey)
    .where('agency_id', '=', leadAgencyId)
    .where('enabled', '=', true)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (leadAgencyEnabled?.enabled === true) {
    sources.push({
      source: {
        agencyId: leadAgencyId,
        agencyName: normalizeSourceName(profile.agency_name_en, profile.agency_name_fr, leadAgencyId)
      },
      config: normalizeNarrativeTagsConfig({})
    })
  }

  const rows = await db
    .selectFrom('Funding_Case_Agreement_Applicant_Recipient')
    .innerJoin(
      'Funding_Case_Agreement_Profile',
      'Funding_Case_Agreement_Profile.id',
      'Funding_Case_Agreement_Applicant_Recipient.egcs_fc_fundingagreement'
    )
    .innerJoin(
      'Transfer_Payment_Stream',
      'Transfer_Payment_Stream.id',
      'Funding_Case_Agreement_Profile.egcs_fc_transferpaymentstream'
    )
    .innerJoin(
      'Transfer_Payment_Profile',
      'Transfer_Payment_Profile.id',
      'Transfer_Payment_Stream.egcs_tp_transferpaymentprofile'
    )
    .innerJoin('Agency_Profile', 'Agency_Profile.id', 'Transfer_Payment_Profile.egcs_tp_agency')
    .innerJoin('extensions.agency_enablement', (join: JoinChain) =>
      join
        .onRef('extensions.agency_enablement.agency_id', '=', 'Transfer_Payment_Profile.egcs_tp_agency')
        .on('extensions.agency_enablement.extension_key', '=', extensionKey)
        .on('extensions.agency_enablement.enabled', '=', true)
        .on('extensions.agency_enablement._deleted', '=', false)
    )
    .innerJoin('extensions.stream_configuration', (join: JoinChain) =>
      join
        .onRef('extensions.stream_configuration.stream_id', '=', 'Transfer_Payment_Stream.id')
        .on('extensions.stream_configuration.extension_key', '=', extensionKey)
        .on('extensions.stream_configuration.enabled', '=', true)
        .on('extensions.stream_configuration._deleted', '=', false)
    )
    .select([
      'Transfer_Payment_Profile.egcs_tp_agency as agency_id',
      'Agency_Profile.egcs_ay_name_en as agency_name_en',
      'Agency_Profile.egcs_ay_name_fr as agency_name_fr',
      'Transfer_Payment_Stream.id as stream_id',
      'Transfer_Payment_Stream.egcs_tp_name_en as stream_name_en',
      'Transfer_Payment_Stream.egcs_tp_name_fr as stream_name_fr',
      'extensions.stream_configuration.config as config'
    ])
    .where('Funding_Case_Agreement_Applicant_Recipient.egcs_fc_applicantrecipient', '=', applicantRecipientId)
    .where('Funding_Case_Agreement_Applicant_Recipient._deleted', '=', false)
    .where('Funding_Case_Agreement_Profile._deleted', '=', false)
    .where('Transfer_Payment_Stream._deleted', '=', false)
    .where('Transfer_Payment_Profile._deleted', '=', false)
    .execute()

  const seenSourceKeys = new Set(sources.map(item => `${item.source.agencyId}:${item.source.streamId ?? 'agency'}`))
  for (const row of rows) {
    const agencyId = String(row.agency_id ?? '')
    const streamId = String(row.stream_id ?? '')
    if (!agencyId || !streamId) {
      continue
    }

    const source: NarrativeTagSource = {
      agencyId,
      agencyName: normalizeSourceName(row.agency_name_en, row.agency_name_fr, agencyId),
      streamId,
      streamName: normalizeSourceName(row.stream_name_en, row.stream_name_fr, streamId)
    }
    const sourceKey = `${source.agencyId}:${source.streamId}`
    if (seenSourceKeys.has(sourceKey)) {
      continue
    }

    seenSourceKeys.add(sourceKey)
    sources.push({
      source,
      config: normalizeNarrativeTagsConfig(row.config)
    })
  }

  return sources
}

export const getPersistedNarrativeTags = async (
  db: NarrativeTagsRouteDatabase,
  extensionKey: string,
  agreementId: string
): Promise<NarrativeTagValue[]> => {
  const row = await db
    .selectFrom('extensions.kv_entry')
    .select('value')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', NARRATIVE_TAGS_OWNER_TYPE)
    .where('owner_id', '=', agreementId)
    .where('config_key', '=', NARRATIVE_TAGS_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const value = row?.value
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): NarrativeTagValue[] => {
    if (typeof item === 'string') {
      return [{
        predefined: true as const,
        key: item,
        label: item
      }]
    }

    if (typeof item !== 'object' || item === null || !('predefined' in item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const source = normalizeNarrativeTagSource(record.source)
    if (record.predefined === true && typeof record.key === 'string' && typeof record.label === 'string') {
      return [{
        predefined: true as const,
        key: record.key,
        label: record.label,
        source
      }]
    }

    if (record.predefined === false && typeof record.label === 'string') {
      return [{
        predefined: false as const,
        label: record.label,
        source
      }]
    }

    return []
  })
}

export const setPersistedNarrativeTags = async (
  db: NarrativeTagsRouteDatabase,
  extensionKey: string,
  agreementId: string,
  tags: NarrativeTagValue[]
) => {
  const existing = await db
    .selectFrom('extensions.kv_entry')
    .select('id')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', NARRATIVE_TAGS_OWNER_TYPE)
    .where('owner_id', '=', agreementId)
    .where('config_key', '=', NARRATIVE_TAGS_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    return await db
      .updateTable('extensions.kv_entry')
      .set({ value: tags as unknown as JsonValue })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst()
  }

  return await db
    .insertInto('extensions.kv_entry')
    .values({
      extension_key: extensionKey,
      owner_type: NARRATIVE_TAGS_OWNER_TYPE,
      owner_id: agreementId,
      config_key: NARRATIVE_TAGS_CONFIG_KEY,
      value: tags as unknown as JsonValue
    })
    .returningAll()
    .executeTakeFirst()
}

export const getPersistedTextFieldTags = async (
  db: NarrativeTagsRouteDatabase,
  extensionKey: string,
  ownerType: string,
  ownerId: string
): Promise<Record<string, NarrativeTagValue[]>> => {
  const row = await db
    .selectFrom('extensions.kv_entry')
    .select('value')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', ownerType)
    .where('owner_id', '=', ownerId)
    .where('config_key', '=', NARRATIVE_TAGS_TEXT_FIELD_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const value = row?.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, NarrativeTagValue[]>>((acc, [key, tags]) => {
    const normalizedTags = Array.isArray(tags)
      ? tags.flatMap((item): NarrativeTagValue[] => {
          if (typeof item !== 'object' || item === null || !('predefined' in item)) return []
          const record = item as Record<string, unknown>
          const source = normalizeNarrativeTagSource(record.source)
          if (record.predefined === true && typeof record.key === 'string' && typeof record.label === 'string') {
            return [{ predefined: true as const, key: record.key, label: record.label, source }]
          }
          if (record.predefined === false && typeof record.label === 'string') {
            return [{ predefined: false as const, label: record.label, source }]
          }
          return []
        })
      : []
    acc[key] = normalizedTags
    return acc
  }, {})
}

export const setPersistedTextFieldTags = async (
  db: NarrativeTagsRouteDatabase,
  extensionKey: string,
  ownerType: string,
  ownerId: string,
  tagsByField: Record<string, NarrativeTagValue[]>
) => {
  const existing = await db
    .selectFrom('extensions.kv_entry')
    .select('id')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', ownerType)
    .where('owner_id', '=', ownerId)
    .where('config_key', '=', NARRATIVE_TAGS_TEXT_FIELD_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    return await db
      .updateTable('extensions.kv_entry')
      .set({ value: tagsByField as unknown as JsonValue })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst()
  }

  return await db
    .insertInto('extensions.kv_entry')
    .values({
      extension_key: extensionKey,
      owner_type: ownerType,
      owner_id: ownerId,
      config_key: NARRATIVE_TAGS_TEXT_FIELD_CONFIG_KEY,
      value: tagsByField as unknown as JsonValue
    })
    .returningAll()
    .executeTakeFirst()
}

export const validateRequestedTags = (
  config: NarrativeTagsRouteContext['config'],
  tags: unknown,
  locale?: 'en' | 'fr',
  targetKey: GcsTextareaKnownTargetKey = 'agreement.description'
): NarrativeTagValue[] | null => normalizeNarrativeTagValues(config, tags, locale, targetKey)

export const validateRequestedSourceTags = (
  sources: NarrativeTagSourceConfig[],
  tags: unknown,
  locale?: 'en' | 'fr',
  targetKey: GcsTextareaKnownTargetKey = 'proponent.description'
): NarrativeTagValue[] | null => {
  if (!Array.isArray(tags)) {
    return null
  }

  const normalized: NarrativeTagValue[] = []
  const seenKeys = new Set<string>()
  for (const tag of tags) {
    const source = normalizeNarrativeTagSource(typeof tag === 'object' && tag !== null ? (tag as Record<string, unknown>).source : undefined)
    const sourceConfig = source
      ? sources.find(item => sameNarrativeTagSource(item.source, source))
      : sources[0]
    if (!sourceConfig) {
      return null
    }

    const validated = normalizeNarrativeTagValues(sourceConfig.config, [tag], locale, targetKey)
    if (!validated || validated.length !== 1) {
      return null
    }

    const value = source ? { ...validated[0], source: sourceConfig.source } : validated[0]
    const key = `${value.source?.agencyId ?? ''}:${value.source?.streamId ?? 'agency'}:${value.predefined ? value.key : value.label.toLowerCase()}`
    if (seenKeys.has(key)) {
      return null
    }

    seenKeys.add(key)
    normalized.push(value)
  }

  return normalized
}
