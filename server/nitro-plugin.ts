/* eslint-disable jsdoc/require-jsdoc */
import { createError } from 'h3'
import {
  AGREEMENT_TAGS_EXTENSION_KEY,
  AGREEMENT_TAGS_PROPONENT_OWNER_TYPE,
  setPersistedAgreementTags,
  setPersistedTextFieldTags,
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

const resolveTextFieldTags = (rawBody: Record<string, unknown>): Record<string, unknown> | null => {
  const extensions = isRecord(rawBody.extensions) ? rawBody.extensions : {}
  const extensionPayload = isRecord(extensions[AGREEMENT_TAGS_EXTENSION_KEY])
    ? extensions[AGREEMENT_TAGS_EXTENSION_KEY]
    : {}

  return isRecord(extensionPayload.textFieldTags) ? extensionPayload.textFieldTags : null
}

const validateTextFieldTags = (
  config: ReturnType<typeof normalizeAgreementTagsConfig>,
  value: Record<string, unknown>
) => {
  const entries = Object.entries(value)
  const normalized: Record<string, ReturnType<typeof validateRequestedTags>> = {}

  for (const [key, tags] of entries) {
    const locale = key.endsWith(':fr') ? 'fr' : 'en'
    const validatedTags = validateRequestedTags(config, tags, locale)
    if (!validatedTags) {
      return null
    }
    normalized[key] = validatedTags
  }

  return normalized as Record<string, NonNullable<ReturnType<typeof validateRequestedTags>>>
}

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('agreement:profile:updated', async payload => {
    const requestedTags = resolveAgreementDescriptionTags(payload.rawBody)
    const textFieldTags = resolveTextFieldTags(payload.rawBody)
    if (requestedTags === undefined && !textFieldTags) {
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
    const tags = requestedTags === undefined ? [] : validateRequestedTags(config, requestedTags)
    if (requestedTags !== undefined && !tags) {
      throw createError({
        statusCode: 400,
        message: 'Tags must match the configured agreement tag rules.',
        data: {
          code: 'INVALID_TAGS',
          message: 'Tags must match the configured agreement tag rules.'
        }
      })
    }

    if (requestedTags !== undefined && tags) {
      await setPersistedAgreementTags(
        payload.event.context.$db as never,
        AGREEMENT_TAGS_EXTENSION_KEY,
        payload.agreementId,
        tags
      )
    }

    if (textFieldTags) {
      const normalizedTextFieldTags = validateTextFieldTags(config, textFieldTags)
      if (!normalizedTextFieldTags) {
        throw createError({
          statusCode: 400,
          message: 'Tags must match the configured agreement tag rules.',
          data: {
            code: 'INVALID_TAGS',
            message: 'Tags must match the configured agreement tag rules.'
          }
        })
      }

      await setPersistedTextFieldTags(
        payload.event.context.$db as never,
        AGREEMENT_TAGS_EXTENSION_KEY,
        'fundingcaseagreement',
        payload.agreementId,
        normalizedTextFieldTags
      )
    }
  })

  nitroApp.hooks.hook('applicantrecipient:profile:updated', async payload => {
    const textFieldTags = resolveTextFieldTags(payload.rawBody)
    if (!textFieldTags) {
      return
    }

    const row = await payload.event.context.$db
      .selectFrom('extensions.agency_enablement')
      .select('enabled')
      .where('extension_key', '=', AGREEMENT_TAGS_EXTENSION_KEY)
      .where('agency_id', '=', payload.agencyId)
      .where('_deleted', '=', false)
      .executeTakeFirst()

    if (row?.enabled !== true) {
      return
    }

    const config = normalizeAgreementTagsConfig({})
    const normalizedTextFieldTags = validateTextFieldTags(config, textFieldTags)
    if (!normalizedTextFieldTags) {
      throw createError({
        statusCode: 400,
        message: 'Tags must match the configured agreement tag rules.',
        data: {
          code: 'INVALID_TAGS',
          message: 'Tags must match the configured agreement tag rules.'
        }
      })
    }

    await setPersistedTextFieldTags(
      payload.event.context.$db as never,
      AGREEMENT_TAGS_EXTENSION_KEY,
      AGREEMENT_TAGS_PROPONENT_OWNER_TYPE,
      payload.applicantRecipientId,
      normalizedTextFieldTags
    )
  })
})
