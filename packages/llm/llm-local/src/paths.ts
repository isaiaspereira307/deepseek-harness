import { mkdir } from 'node:fs/promises'

/**
 * Create `modelsDir` (recursively) when it does not exist yet. Fresh installs
 * have no models directory; failing to create it would treat first use as a
 * configuration error.
 * @param modelsDir - directory that holds downloaded `.gguf` files.
 * @throws the `mkdir` failure when the path exists as a file or cannot be created.
 */
export async function ensureModelsDir(modelsDir: string): Promise<void> {
  await mkdir(modelsDir, { recursive: true })
}
