/* eslint-disable jsdoc/require-jsdoc */
import { readBody } from 'h3'
import {
  createExtensionRouteErrorResponse,
  resolveNarrativeTagsRouteContext,
  setPersistedNarrativeTags,
  validateRequestedTags
} from '../../../../../../../narrative-tags-route'

export default async (event: Parameters<EventHandler>[0]) => {
  const routeContext = await resolveNarrativeTagsRouteContext(event as never, 'update')

  const body = await readBody<{ tags?: unknown }>(event as never)
  const requestedTags = validateRequestedTags(routeContext.config, body.tags)
  if (!requestedTags) {
    return createExtensionRouteErrorResponse(400, 'INVALID_TAGS', 'Tags must match the configured narrative tag rules.')
  }

  const row = await setPersistedNarrativeTags(
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
