/* eslint-disable jsdoc/require-jsdoc */
import { createError } from 'h3'
import {
  AGREEMENT_TAGS_EXTENSION_KEY,
  setPersistedAgreementTags,
  validateRequestedTags
} from './agreement-tags-route'
import { normalizeAgreementTagsConfig } from '../components/agreement-tags'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const resolveAgreementDescriptionTags = (rawBody: Record<string, unknown>): unknown => {
  const extensions = isRecord(rawBody.extensions) ? rawBody.extensions : {}
  const extensionPayload = isRecord(extensions[AGREEMENT_TAGS_EXTENSION_KEY])
    ? extensions[AGREEMENT_TAGS_EXTENSION_KEY]
    : {}

  return extensionPayload.agreementDescriptionTags
}

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('agreement:profile:updated', async payload => {
    const requestedTags = resolveAgreementDescriptionTags(payload.rawBody)
    if (requestedTags === undefined) {
      return
    }

    const row = await payload.event.context.$db
      .selectFrom('extensions.stream_configuration')
      .select(['enabled', 'config'])
      .where('extension_key', '=', AGREEMENT_TAGS_EXTENSION_KEY)
      .where('stream_id', '=', payload.streamId)
      .where('_deleted', '=', false)
      .executeTakeFirst()

    if (row?.enabled !== true) {
      return
    }

    const config = normalizeAgreementTagsConfig(row.config)
    const tags = validateRequestedTags(config, requestedTags)
    if (!tags) {
      throw createError({
        statusCode: 400,
        message: 'Tags must match the configured agreement tag rules.',
        data: {
          code: 'INVALID_TAGS',
          message: 'Tags must match the configured agreement tag rules.'
        }
      })
    }

    await setPersistedAgreementTags(
      payload.event.context.$db as never,
      AGREEMENT_TAGS_EXTENSION_KEY,
      payload.agreementId,
      tags
    )
  })
})
