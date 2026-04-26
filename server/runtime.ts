import type { GcsExtensionRuntimeContext, GcsExtensionRuntimeResolution } from '@gcs-ssc/extensions'
import {
  NARRATIVE_TAGS_EXTENSION_KEY,
  resolveProponentNarrativeTagSources,
  type NarrativeTagsRouteDatabase
} from './narrative-tags-route'

export default async (
  event: { context: { $db: unknown } },
  context: GcsExtensionRuntimeContext
): Promise<GcsExtensionRuntimeResolution | null> => {
  if (
    context.slot !== 'proponent.descriptions.after'
    || !context.agencyId
    || !context.applicantRecipientId
  ) {
    return null
  }

  const sources = await resolveProponentNarrativeTagSources(
    event.context.$db as NarrativeTagsRouteDatabase,
    NARRATIVE_TAGS_EXTENSION_KEY,
    context.agencyId,
    context.applicantRecipientId
  )

  return sources.length > 0
    ? {
        enabled: true,
        config: {}
      }
    : null
}
