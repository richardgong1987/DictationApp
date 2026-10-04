/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by the Tauri CLI when it builds the frontend: "darwin", "windows", "linux", "ios", … */
  readonly TAURI_ENV_PLATFORM?: string;
}
