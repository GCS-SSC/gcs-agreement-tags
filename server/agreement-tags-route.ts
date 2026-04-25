/* eslint-disable jsdoc/require-jsdoc */
import type { JsonValue } from '@gcs-ssc/extensions'
import { normalizeAgreementTagsConfig, validTagKeys } from '../components/agreement-tags'

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
  extensionKey: string
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

export const createExtensionRouteErrorResponse = (
  event: Parameters<EventHandler>[0],
  statusCode: number,
  code: string,
  message: string
): {
  statusCode: number
  message: string
  data: {
    message: string
    code: string
  }
} => {
  if (event.node?.res) {
    event.node.res.statusCode = statusCode
    event.node.res.statusMessage = message
  }

  return {
    statusCode,
    message,
    data: {
      message,
      code
    }
  }
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
  event: Parameters<EventHandler>[0],
  action: 'read' | 'update'
): Promise<AgreementTagsRouteContext | ReturnType<typeof createExtensionRouteErrorResponse>> => {
  const db = event.context.$db as AgreementTagsRouteDatabase
  const extensionKey = event.context.params?.extensionKey
  const streamId = event.context.params?.streamId
  const agreementId = event.context.params?.agreementId

  if (!extensionKey || !streamId || !agreementId) {
    return createExtensionRouteErrorResponse(event, 400, 'MISSING_ID', 'Missing extension route identifiers.')
  }

  const agreement = await resolveAgreementContext(db, streamId, agreementId)
  if (!agreement) {
    return createExtensionRouteErrorResponse(event, 404, 'AGREEMENT_NOT_FOUND', 'Agreement not found.')
  }

  const streamConfig = await getStreamConfiguration(db, extensionKey, streamId)
  if (!streamConfig.enabled) {
    return createExtensionRouteErrorResponse(event, 403, 'EXTENSION_STREAM_DISABLED', 'Extension is disabled for this stream.')
  }

  const authContext = event.context.$authContext
  if (!authContext) {
    return createExtensionRouteErrorResponse(event, 401, 'AUTH_UNAUTHORIZED', 'Unauthorized.')
  }

  const scope = buildAgreementScope(agreement.agencyId, agreement.profileId, agreement.streamId, agreement.agreementId)
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
    return createExtensionRouteErrorResponse(event, 403, 'AUTH_FORBIDDEN', 'Forbidden.')
  }

  return {
    extensionKey,
    streamId,
    agreementId,
    agencyId: agreement.agencyId,
    profileId: agreement.profileId,
    scope,
    config: streamConfig.config
  }
}

export const isRouteError = (
  value: AgreementTagsRouteContext | ReturnType<typeof createExtensionRouteErrorResponse>
): value is ReturnType<typeof createExtensionRouteErrorResponse> => 'statusCode' in value

export const getPersistedAgreementTags = async (
  db: AgreementTagsRouteDatabase,
  extensionKey: string,
  agreementId: string
): Promise<string[]> => {
  const row = await db
    .selectFrom('extensions.kv_entry')
    .select('value')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', 'fundingcaseagreement')
    .where('owner_id', '=', agreementId)
    .where('config_key', '=', 'agreement-description-tags')
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const value = row?.value
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(item => typeof item === 'string')
}

export const setPersistedAgreementTags = async (
  db: AgreementTagsRouteDatabase,
  extensionKey: string,
  agreementId: string,
  tags: string[]
) => {
  const existing = await db
    .selectFrom('extensions.kv_entry')
    .select('id')
    .where('extension_key', '=', extensionKey)
    .where('owner_type', '=', 'fundingcaseagreement')
    .where('owner_id', '=', agreementId)
    .where('config_key', '=', 'agreement-description-tags')
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
      owner_type: 'fundingcaseagreement',
      owner_id: agreementId,
      config_key: 'agreement-description-tags',
      value: tags as JsonValue
    })
    .returningAll()
    .executeTakeFirst()
}

export const validateRequestedTags = (
  config: AgreementTagsRouteContext['config'],
  tags: unknown
): string[] | null => {
  if (!Array.isArray(tags)) {
    return null
  }

  const allowedKeys = validTagKeys(config)
  const normalized = Array.from(new Set(tags.filter(item => typeof item === 'string')))
  if (normalized.some(tag => !allowedKeys.has(tag))) {
    return null
  }

  return normalized
}
