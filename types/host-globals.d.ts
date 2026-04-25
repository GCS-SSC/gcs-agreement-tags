declare const useToast: () => {
  add: (input: { title: string; description?: string; color?: string }) => void
}

declare const $fetch: <T = unknown>(
  url: string,
  options?: {
    method?: string
    body?: unknown
  }
) => Promise<T>

interface GcsNitroPluginApp {
  hooks: {
    hook: (
      name: string,
      handler: (payload: any) => void | Promise<void>
    ) => void
  }
}

declare const defineNitroPlugin: (
  plugin: (nitroApp: GcsNitroPluginApp) => void | Promise<void>
) => (nitroApp: GcsNitroPluginApp) => void | Promise<void>
