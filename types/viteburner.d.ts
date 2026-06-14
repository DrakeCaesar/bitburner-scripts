declare module "viteburner" {
  export interface ViteburnerConfig {
    watch?: Array<{
      pattern: string
      transform?: boolean
    }>
    sourcemap?: string | boolean
    download?: {
      server?: string | string[]
      location?: (file: string, server: string) => string | null | undefined
      ignoreTs?: boolean
      ignoreSourcemap?: boolean
    }
  }

  export interface Config {
    resolve?: {
      alias?: Record<string, string>
    }
    build?: {
      outDir?: string
      emptyOutDir?: boolean
      minify?: boolean
    }
    viteburner?: ViteburnerConfig
  }

  export function defineConfig(config: Config): Config
}
