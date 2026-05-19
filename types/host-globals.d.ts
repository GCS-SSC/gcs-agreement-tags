interface GcsNitroPluginApp {
  hooks: {
    hook: (
      name: string,
      handler: (payload: any) => void | Promise<void>
    ) => void
  }
}
