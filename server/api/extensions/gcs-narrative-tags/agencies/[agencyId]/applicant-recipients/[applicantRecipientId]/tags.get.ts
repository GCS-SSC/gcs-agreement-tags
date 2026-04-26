import {
  NARRATIVE_TAGS_EXTENSION_KEY,
  NARRATIVE_TAGS_PROPONENT_OWNER_TYPE,
  createExtensionRouteErrorResponse,
  getPersistedTextFieldTags,
  resolveProponentNarrativeTagSources,
  type NarrativeTagsRouteDatabase
} from '../../../../../../../narrative-tags-route'

export default async (event: Parameters<EventHandler>[0]) => {
  const db = event.context.$db as NarrativeTagsRouteDatabase
  const extensionKey = event.context.params?.extensionKey
  const agencyId = event.context.params?.agencyId
  const applicantRecipientId = event.context.params?.applicantRecipientId

  if (
    extensionKey !== NARRATIVE_TAGS_EXTENSION_KEY
    || typeof agencyId !== 'string'
    || typeof applicantRecipientId !== 'string'
  ) {
    return createExtensionRouteErrorResponse(400, 'MISSING_ID', 'Missing extension route identifiers.')
  }

  const authContext = event.context.$authContext
  if (!authContext) {
    return createExtensionRouteErrorResponse(401, 'AUTH_UNAUTHORIZED', 'Unauthorized.')
  }

  const sources = await resolveProponentNarrativeTagSources(
    db,
    NARRATIVE_TAGS_EXTENSION_KEY,
    agencyId,
    applicantRecipientId
  )

  if (sources.length === 0) {
    return createExtensionRouteErrorResponse(404, 'APPLICANT_RECIPIENT_PROFILE_NOT_FOUND', 'Proponent not found.')
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
    NARRATIVE_TAGS_EXTENSION_KEY,
    NARRATIVE_TAGS_PROPONENT_OWNER_TYPE,
    applicantRecipientId
  )

  return {
    tags: textFieldTags['proponent.description'] ?? textFieldTags['proponent.description:en'] ?? [],
    textFieldTags,
    sources
  }
}
