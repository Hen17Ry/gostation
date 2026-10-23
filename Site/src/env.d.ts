interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string
  readonly PUBLIC_APK_URL?: string
  readonly PUBLIC_APP_ENV?: 'development' | 'staging' | 'production'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Navigator {
  readonly deviceMemory?: number
  readonly connection?: { readonly saveData?: boolean }
}
