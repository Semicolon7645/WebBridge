import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const configPath = resolve(
	process.env.CONFIG_PATH ?? './data/config',
)

export const songsPath = resolve(
	process.env.SONGS_PATH ?? './data/songs',
)

export const tempPath = join(configPath, 'temp')
export const settingsPath = join(configPath, 'settings.json')
export const catalogPath = join(configPath, 'catalog.db')

export const frontendPath = resolve(
	process.env.FRONTEND_PATH ?? 'dist/angular/browser',
)

export async function ensureStorageDirectories(): Promise<void> {
	await Promise.all([
		mkdir(configPath, { recursive: true }),
		mkdir(tempPath, { recursive: true }),
		mkdir(songsPath, { recursive: true }),
	])
}

