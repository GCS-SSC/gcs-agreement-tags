/* eslint-disable jsdoc/require-jsdoc */
import {
  getPersistedNarrativeTags,
  getPersistedTextFieldTags,
  resolveNarrativeTagsRouteContext
} from '../../../../../../../narrative-tags-route'

export default async (event: Parameters<EventHandler>[0]) => {
  const routeContext = await resolveNarrativeTagsRouteContext(event as never, 'read')

  const tags = await getPersistedNarrativeTags(
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
