import {
  AGREEMENT_TAGS_EXTENSION_KEY,
  AGREEMENT_TAGS_PROPONENT_OWNER_TYPE,
  createExtensionRouteErrorResponse,
  getPersistedTextFieldTags,
  type AgreementTagsRouteDatabase
} from '../../../../../../../agreement-tags-route'

export default async (event: Parameters<EventHandler>[0]) => {
  const db = event.context.$db as AgreementTagsRouteDatabase
  const extensionKey = event.context.params?.extensionKey
  const agencyId = event.context.params?.agencyId
  const applicantRecipientId = event.context.params?.applicantRecipientId

  if (
    extensionKey !== AGREEMENT_TAGS_EXTENSION_KEY
    || typeof agencyId !== 'string'
    || typeof applicantRecipientId !== 'string'
  ) {
    return createExtensionRouteErrorResponse(400, 'MISSING_ID', 'Missing extension route identifiers.')
  }

  const authContext = event.context.$authContext
  if (!authContext) {
    return createExtensionRouteErrorResponse(401, 'AUTH_UNAUTHORIZED', 'Unauthorized.')
  }

  const profile = await db
    .selectFrom('Applicant_Recipient_Profile')
    .select(['id', 'egcs_ar_leadagency'])
    .where('id', '=', applicantRecipientId)
    .where('egcs_ar_leadagency', '=', agencyId)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (!profile) {
    return createExtensionRouteErrorResponse(404, 'APPLICANT_RECIPIENT_PROFILE_NOT_FOUND', 'Proponent not found.')
  }

  const extensionEnabled = await db
    .selectFrom('extensions.agency_enablement')
    .select('id')
    .where('extension_key', '=', AGREEMENT_TAGS_EXTENSION_KEY)
    .where('agency_id', '=', agencyId)
    .where('enabled', '=', true)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (!extensionEnabled) {
    return createExtensionRouteErrorResponse(403, 'EXTENSION_AGENCY_DISABLED', 'Extension is disabled for this agency.')
  }

  const canRead = authContext.userAbilities.authorize('applicant_recipient', 'read', {
    type: 'agency',
    agencyId
  })
  if (!canRead) {
    return createExtensionRouteErrorResponse(403, 'AUTH_FORBIDDEN', 'Forbidden.')
  }

  const textFieldTags = await getPersistedTextFieldTags(
    db,
    AGREEMENT_TAGS_EXTENSION_KEY,
    AGREEMENT_TAGS_PROPONENT_OWNER_TYPE,
    applicantRecipientId
  )

  return {
    tags: textFieldTags['proponent.description'] ?? textFieldTags['proponent.description:en'] ?? [],
    textFieldTags
  }
}
