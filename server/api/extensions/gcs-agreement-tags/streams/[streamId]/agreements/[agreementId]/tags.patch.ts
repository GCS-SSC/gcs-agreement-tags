/* eslint-disable jsdoc/require-jsdoc */
import { readBody } from 'h3'
import {
  createExtensionRouteErrorResponse,
  resolveAgreementTagsRouteContext,
  setPersistedAgreementTags,
  validateRequestedTags
} from '../../../../../../../agreement-tags-route'

export default async (event: Parameters<EventHandler>[0]) => {
  const routeContext = await resolveAgreementTagsRouteContext(event as never, 'update')

  const body = await readBody<{ tags?: unknown }>(event as never)
  const requestedTags = validateRequestedTags(routeContext.config, body.tags)
  if (!requestedTags) {
    return createExtensionRouteErrorResponse(400, 'INVALID_TAGS', 'Tags must match the configured agreement tag rules.')
  }

  const row = await setPersistedAgreementTags(
    event.context.$db as never,
    routeContext.extensionKey,
    routeContext.agreementId,
    requestedTags
  )

  return {
    tags: requestedTags,
    row
  }
}
