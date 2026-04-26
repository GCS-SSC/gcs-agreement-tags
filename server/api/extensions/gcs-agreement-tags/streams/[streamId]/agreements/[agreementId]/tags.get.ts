/* eslint-disable jsdoc/require-jsdoc */
import {
  getPersistedAgreementTags,
  getPersistedTextFieldTags,
  resolveAgreementTagsRouteContext
} from '../../../../../../../agreement-tags-route'

export default async (event: Parameters<EventHandler>[0]) => {
  const routeContext = await resolveAgreementTagsRouteContext(event as never, 'read')

  const tags = await getPersistedAgreementTags(
    event.context.$db as never,
    routeContext.extensionKey,
    routeContext.agreementId
  )
  const textFieldTags = await getPersistedTextFieldTags(
    event.context.$db as never,
    routeContext.extensionKey,
    'fundingcaseagreement',
    routeContext.agreementId
  )

  return {
    tags: tags.filter(tag => !tag.predefined || routeContext.config.tags.some(item => item.key === tag.key)),
    textFieldTags
  }
}
