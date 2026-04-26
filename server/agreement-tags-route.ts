/* eslint-disable jsdoc/require-jsdoc */
import type { JsonValue } from '@gcs-ssc/extensions'
import { createError } from 'h3'
import { normalizeAgreementTagsConfig, normalizeAgreementTagValues } from '../components/agreement-tags'
import type { AgreementTagValue } from '../components/agreement-tags'

export const AGREEMENT_TAGS_EXTENSION_KEY = 'gcs-agreement-tags'
export const AGREEMENT_TAGS_OWNER_TYPE = 'fundingcaseagreement'
export const AGREEMENT_TAGS_PROPONENT_OWNER_TYPE = 'applicantrecipient'
export const AGREEMENT_TAGS_CONFIG_KEY = 'agreement-description-tags'
export const AGREEMENT_TAGS_TEXT_FIELD_CONFIG_KEY = 'text-field-tags'

interface QueryChain {
  innerJoin: (...args: unknown[]) => QueryChain
  select: (...args: unknown[]) => QueryChain
  where: (...args: unknown[]) => QueryChain
  executeTakeFirst: () => Promise<Record<string, unknown> | undefined>
}

interface MutationChain {
  values: (...args: unknown[]) => MutationChain
  set: (...args: unknown[]) => MutationChain
  where: (...args: unknown[]) => MutationChain
  returningAll: () => MutationChain
  executeTakeFirst: () => Promise<Record<string, unknown> | undefined>
}

export interface AgreementTagsRouteDatabase {
  selectFrom: (table: string) => QueryChain
  insertInto: (table: string) => MutationChain
  updateTable: (table: string) => MutationChain
}

export interface AgreementTagsRouteContext {
  extensionKey: typeof AGREEMENT_TAGS_EXTENSION_KEY
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
  config: ReturnType<typeof normalizeAgreementTagsConfig>
}

interface AgreementTagsRouteEvent {
  context: {
    $db: unknown
    $authContext?: {
      userId: string
      userAbilities: {
        authorizeWithTeam: (
          resource: string,
          action: string,
          scope: AgreementTagsRouteContext['scope'],
          userId: string,
          includeTeams: boolean,
          db: AgreementTagsRouteDatabase
        ) => Promise<boolean>
        authorize: (
          resource: string,
          action: string,
          scope: AgreementTagsRouteContext['scope']
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
): AgreementTagsRouteContext['scope'] => ({
  type: 'entity',
  agencyId,
  path: [
    { type: 'transfer_payment', id: profileId },
    { type: 'transfer_payment_stream', id: streamId },
    { type: 'fundingcaseagreement', id: agreementId }
  ]
})

const resolveAgreementContext = async (
  db: AgreementTagsRouteDatabase,
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
  db: AgreementTagsRouteDatabase,
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
    config: normalizeAgreementTagsConfig(row?.config)
  }
}

export const resolveAgreementTagsRouteContext = async (
  event: AgreementTagsRouteEvent,
  action: 'read' | 'update'
): Promise<AgreementTagsRouteContext> => {
  const db = event.context.$db as AgreementTagsRouteDatabase
  const extensionKey = event.context.params?.extensionKey
  const streamId = event.context.params?.streamId
  const agreementId = event.context.params?.agreementId

  if (typeof extensionKey !== 'string' || typeof streamId !== 'string' || typeof agreementId !== 'string') {
    return createExtensionRouteErrorResponse(400, 'MISSING_ID', 'Missing extension route identifiers.')
  }
  const resolvedStreamId = streamId
  const resolvedAgreementId = agreementId

  if (extensionKey !== AGREEMENT_TAGS_EXTENSION_KEY) {
    return createExtensionRouteErrorResponse(404, 'EXTENSION_NOT_FOUND', 'Extension not found.')
  }

  const agreement = await resolveAgreementContext(db, resolvedStreamId, resolvedAgreementId)
  if (!agreement) {
    return createExtensionRouteErrorResponse(404, 'AGREEMENT_NOT_FOUND', 'Agreement not found.')
  }
  const resolvedAgreement = agreement

  const streamConfig = await getStreamConfiguration(db, AGREEMENT_TAGS_EXTENSION_KEY, resolvedStreamId)
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
    extensionKey: AGREEMENT_TAGS_EXTENSION_KEY,
    streamId: resolvedStreamId,
    agreementId: resolvedAgreementId,
    agencyId: resolvedAgreement.agencyId,
    profileId: resolvedAgreement.profileId,
    scope,
    config: streamConfig.config
  }
}

export const getPersistedAgreementTags = async (
  db: AgreementTagsRouteDatabase,
  extensionKey: string,
  agreementId: string
): Promise<AgreementTagValue[]> => {
  const row = await db
    .selectFrom('extensions.kv_entry')
    .select('value')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', AGREEMENT_TAGS_OWNER_TYPE)
    .where('owner_id', '=', agreementId)
    .where('config_key', '=', AGREEMENT_TAGS_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const value = row?.value
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): AgreementTagValue[] => {
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
    if (record.predefined === true && typeof record.key === 'string' && typeof record.label === 'string') {
      return [{
        predefined: true as const,
        key: record.key,
        label: record.label
      }]
    }

    if (record.predefined === false && typeof record.label === 'string') {
      return [{
        predefined: false as const,
        label: record.label
      }]
    }

    return []
  })
}

export const setPersistedAgreementTags = async (
  db: AgreementTagsRouteDatabase,
  extensionKey: string,
  agreementId: string,
  tags: AgreementTagValue[]
) => {
  const existing = await db
    .selectFrom('extensions.kv_entry')
    .select('id')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', AGREEMENT_TAGS_OWNER_TYPE)
    .where('owner_id', '=', agreementId)
    .where('config_key', '=', AGREEMENT_TAGS_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    return await db
      .updateTable('extensions.kv_entry')
      .set({ value: tags as JsonValue })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst()
  }

  return await db
    .insertInto('extensions.kv_entry')
    .values({
      extension_key: extensionKey,
      owner_type: AGREEMENT_TAGS_OWNER_TYPE,
      owner_id: agreementId,
      config_key: AGREEMENT_TAGS_CONFIG_KEY,
      value: tags as JsonValue
    })
    .returningAll()
    .executeTakeFirst()
}

export const getPersistedTextFieldTags = async (
  db: AgreementTagsRouteDatabase,
  extensionKey: string,
  ownerType: string,
  ownerId: string
): Promise<Record<string, AgreementTagValue[]>> => {
  const row = await db
    .selectFrom('extensions.kv_entry')
    .select('value')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', ownerType)
    .where('owner_id', '=', ownerId)
    .where('config_key', '=', AGREEMENT_TAGS_TEXT_FIELD_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const value = row?.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, AgreementTagValue[]>>((acc, [key, tags]) => {
    const normalizedTags = Array.isArray(tags)
      ? tags.flatMap((item): AgreementTagValue[] => {
          if (typeof item !== 'object' || item === null || !('predefined' in item)) return []
          const record = item as Record<string, unknown>
          if (record.predefined === true && typeof record.key === 'string' && typeof record.label === 'string') {
            return [{ predefined: true as const, key: record.key, label: record.label }]
          }
          if (record.predefined === false && typeof record.label === 'string') {
            return [{ predefined: false as const, label: record.label }]
          }
          return []
        })
      : []
    acc[key] = normalizedTags
    return acc
  }, {})
}

export const setPersistedTextFieldTags = async (
  db: AgreementTagsRouteDatabase,
  extensionKey: string,
  ownerType: string,
  ownerId: string,
  tagsByField: Record<string, AgreementTagValue[]>
) => {
  const existing = await db
    .selectFrom('extensions.kv_entry')
    .select('id')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', ownerType)
    .where('owner_id', '=', ownerId)
    .where('config_key', '=', AGREEMENT_TAGS_TEXT_FIELD_CONFIG_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    return await db
      .updateTable('extensions.kv_entry')
      .set({ value: tagsByField as JsonValue })
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
      config_key: AGREEMENT_TAGS_TEXT_FIELD_CONFIG_KEY,
      value: tagsByField as JsonValue
    })
    .returningAll()
    .executeTakeFirst()
}

export const validateRequestedTags = (
  config: AgreementTagsRouteContext['config'],
  tags: unknown,
  locale?: 'en' | 'fr'
): AgreementTagValue[] | null => normalizeAgreementTagValues(config, tags, locale)
