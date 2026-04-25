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
  const tags = validateRequestedTags(routeContext.config, body.tags)
  if (!tags) {
    createExtensionRouteErrorResponse(400, 'INVALID_TAGS', 'Tags must be selected from the configured list.')
  }
  const requestedTags = tags as string[]

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
