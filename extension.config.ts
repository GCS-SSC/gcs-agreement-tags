import { defineGcsExtension } from '@gcs-ssc/extensions'

export default defineGcsExtension({
  key: 'gcs-agreement-tags',
  name: {
    en: 'Text Tags',
    fr: 'Étiquettes d’entente'
  },
  description: {
    en: 'Suggests predefined tags from configured text fields.',
    fr: 'Suggère des étiquettes prédéfinies à partir des champs texte configurés.'
  },
  admin: {
    streamConfig: {
      path: './components/AgreementTagsConfig.vue'
    }
  },
  client: {
    slots: [
      {
        slot: 'agreement.descriptions.after',
        path: './components/AgreementTagsSlot.vue'
      },
      {
        slot: 'proponent.descriptions.after',
        path: './components/AgreementTagsSlot.vue'
      }
    ]
  },
  assets: [
    {
      path: './client',
      baseURL: '/extensions/gcs-agreement-tags/client'
    },
    {
      package: '@browser-tag-extractor/core',
      packagePath: 'models',
      baseURL: '/extensions/gcs-agreement-tags/models'
    }
  ],
  nitroPlugin: './server/nitro-plugin.ts',
  serverHandlers: [
    {
      route: '/streams/[streamId]/agreements/[agreementId]/tags',
      method: 'get',
      path: './server/api/extensions/gcs-agreement-tags/streams/[streamId]/agreements/[agreementId]/tags.get.ts'
    },
    {
      route: '/streams/[streamId]/agreements/[agreementId]/tags',
      method: 'patch',
      path: './server/api/extensions/gcs-agreement-tags/streams/[streamId]/agreements/[agreementId]/tags.patch.ts'
    },
    {
      route: '/agencies/[agencyId]/applicant-recipients/[applicantRecipientId]/tags',
      method: 'get',
      path: './server/api/extensions/gcs-agreement-tags/agencies/[agencyId]/applicant-recipients/[applicantRecipientId]/tags.get.ts'
    }
  ]
})
