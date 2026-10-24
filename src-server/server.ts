import express from 'express'
import { existsSync } from 'node:fs'
import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'

import { configureCatalogDb } from '../src-electron/ipc/catalog/CatalogDatabase.js'
import { catalogPath, configPath, ensureStorageDirectories, frontendPath, songsPath, tempPath } from './paths.js'

configureCatalogDb(catalogPath)

const app = express()
const port = Number(process.env.PORT ?? 8080)

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', async (_req, res) => {
	const checks = await Promise.all(
		[
			['config', configPath],
			['temporary storage', tempPath],
			['song library', songsPath],
		].map(async ([name, path]) => {
			try {
				await access(path!, constants.R_OK | constants.W_OK)
				return { name, writable: true }
			} catch {
				return { name, writable: false }
			}
		}),
	)

	const healthy = checks.every((check) => check.writable)

	res.status(healthy ? 200 : 503).json({
		status: healthy ? 'ok' : 'error',
		storage: checks,
	})
})

app.use(express.static(frontendPath))

app.use((req, res) => {
	if (req.path.startsWith('/api/')) {
		res.status(404).json({ error: 'API endpoint not found' })
		return
	}

	const indexPath = join(frontendPath, 'index.html')

	if (existsSync(indexPath)) {
		res.sendFile(indexPath)
	} else {
		res.status(503).json({
			error: 'Frontend has not been built yet',
		})
	}
})

async function start(): Promise<void> {
	await ensureStorageDirectories()

	app.listen(port, '0.0.0.0', () => {
		console.log(`WebBridge listening on port ${port}`)
		console.log(`Configuration: ${configPath}`)
		console.log(`Song library: ${songsPath}`)
		console.log(`Frontend: ${frontendPath}`)
	})
}

start().catch((error: unknown) => {
	console.error('Failed to start WebBridge:', error)
	process.exitCode = 1
})
