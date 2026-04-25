/* eslint-disable jsdoc/require-jsdoc */
import {
  getPersistedAgreementTags,
  isRouteError,
  resolveAgreementTagsRouteContext
} from '../../../../../../../agreement-tags-route'

export default async (event: Parameters<EventHandler>[0]) => {
  const routeContext = await resolveAgreementTagsRouteContext(event, 'read')
  if (isRouteError(routeContext)) {
    return routeContext
  }

  const tags = await getPersistedAgreementTags(
    event.context.$db as never,
    routeContext.extensionKey,
    routeContext.agreementId
  )

  return {
    tags: tags.filter(tag => routeContext.config.tags.some(item => item.key === tag))
  }
}
