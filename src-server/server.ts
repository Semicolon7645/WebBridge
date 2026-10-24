import express from 'express'
import { existsSync } from 'node:fs'
import { access, constants, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { configureCatalogDb, getCatalogDb } from '../src-electron/ipc/catalog/CatalogDatabase.js'
import { getChartScanner } from '../src-electron/ipc/catalog/ChartScanner.js'
import { defaultSettings } from '../src-shared/Settings.js'
import { catalogPath, configPath, ensureStorageDirectories, frontendPath, settingsPath, songsPath, tempPath } from './paths.js'

import type { Settings } from '../src-shared/Settings.js'
import type { CatalogFilter } from '../src-shared/interfaces/catalog.interface.js'
import type { Response } from 'express'
import type {
	ScanProgress,
	ScanResult,
} from '../src-shared/interfaces/catalog.interface.js'
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


const catalog = '/api/catalog'

app.get(`${catalog}/stats`, (_req, res, next) => {
	try {
		res.json(getCatalogDb().getStats())
	} catch (error) {
		next(error)
	}
})

app.get(`${catalog}/chart/:id`, (req, res, next) => {
	try {
		const id = Number(req.params.id)

		if (!Number.isSafeInteger(id) || id <= 0) {
			res.status(400).json({ error: 'Invalid chart ID' })
			return
		}

		const chart = getCatalogDb().getChart(id)

		if (!chart) {
			res.status(404).json({ error: 'Chart not found' })
			return
		}

		res.json(chart)
	} catch (error) {
		next(error)
	}
})

app.post(`${catalog}/charts`, (req, res, next) => {
	try {
		if (
			req.body === null ||
			typeof req.body !== 'object' ||
			Array.isArray(req.body)
		) {
			res.status(400).json({ error: 'A catalog filter object is required' })
			return
		}

		res.json(getCatalogDb().getCharts(req.body as CatalogFilter))
	} catch (error) {
		next(error)
	}
})

app.post(`${catalog}/charts/count`, (req, res, next) => {
	try {
		if (
			req.body === null ||
			typeof req.body !== 'object' ||
			Array.isArray(req.body)
		) {
			res.status(400).json({ error: 'A catalog filter object is required' })
			return
		}

		res.json(getCatalogDb().getChartsCount(req.body as CatalogFilter))
	} catch (error) {
		next(error)
	}
})

app.post(`${catalog}/charts/exists`, (req, res, next) => {
	try {
		const charts = req.body?.charts

		if (
			!Array.isArray(charts) ||
			!charts.every(
				(chart: unknown) =>
					chart !== null &&
					typeof chart === 'object' &&
					typeof (chart as { artist?: unknown }).artist === 'string' &&
					typeof (chart as { name?: unknown }).name === 'string' &&
					typeof (chart as { charter?: unknown }).charter === 'string',
			)
		) {
			res.status(400).json({
				error: 'An array of charts with artist, name, and charter is required',
			})
			return
		}

		const result = getCatalogDb().checkChartsExist(charts)
		res.json(Object.fromEntries(result))
	} catch (error) {
		next(error)
	}
})

app.get(`${catalog}/distinct/:column`, (req, res, next) => {
	try {
		const column = req.params.column

		if (
			column !== 'artist' &&
			column !== 'charter' &&
			column !== 'genre' &&
			column !== 'album'
		) {
			res.status(400).json({ error: 'Invalid catalog column' })
			return
		}

		res.json(getCatalogDb().getDistinctValues(column))
	} catch (error) {
		next(error)
	}
})

app.get('/api/settings', async (_req, res, next) => {
	try {
		let settings: Settings

		try {
			settings = {
				...defaultSettings,
				...JSON.parse(await readFile(settingsPath, 'utf8')),
			}
		} catch (error) {
			if (
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				settings = { ...defaultSettings }
			} else {
				throw error
			}
		}

		res.json(settings)
	} catch (error) {
		next(error)
	}
})

app.put('/api/settings', async (req, res, next) => {
	try {
		if (
			req.body === null ||
			typeof req.body !== 'object' ||
			Array.isArray(req.body)
		) {
			res.status(400).json({ error: 'A settings object is required' })
			return
		}

		const settings: Settings = {
			...defaultSettings,
			...req.body,
		}

		await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
		res.json({ status: 'ok' })
	} catch (error) {
		next(error)
	}
})

const eventClients = new Set<Response>()

function publishEvent(eventName: string, data: unknown): void {
	const message =
		`event: ${eventName}\n` +
		`data: ${JSON.stringify(data)}\n\n`

	for (const client of eventClients) {
		try {
			client.write(message)
		} catch {
			eventClients.delete(client)
		}
	}
}

app.get('/api/events', (req, res) => {
	res.status(200)
		.set({
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		})
		.flushHeaders()

	res.write('retry: 3000\n\n')
	eventClients.add(res)

	req.on('close', () => {
		eventClients.delete(res)
	})
})

const scanner = getChartScanner()

scanner.on('progress', (progress: ScanProgress) => {
	publishEvent('catalogScanProgress', progress)
})

type ScanStatus =
	| { status: 'idle' | 'running' }
	| { status: 'complete'; result: ScanResult }
	| { status: 'error'; error: string }

let scanStatus: ScanStatus = { status: 'idle' }
let scanInProgress = false

app.get('/api/catalog/scan/status', (_req, res) => {
	res.json(scanStatus)
})

app.post('/api/catalog/scan', (_req, res) => {
	if (scanInProgress) {
		res.status(409).json({
			error: 'A catalog scan is already in progress',
		})
		return
	}

	scanInProgress = true
	scanStatus = { status: 'running' }

	publishEvent('catalogScanStatus', scanStatus)

	void scanner
		.scanLibraryPaths([songsPath])
		.then((result: ScanResult) => {
			scanStatus = { status: 'complete', result }
			publishEvent('catalogScanComplete', result)
		})
		.catch((error: unknown) => {
			const message =
				error instanceof Error ? error.message : String(error)

			scanStatus = { status: 'error', error: message }
			publishEvent('catalogScanError', { error: message })
		})
		.finally(() => {
			scanInProgress = false
			publishEvent('catalogScanStatus', scanStatus)
		})

	res.status(202).json({ status: 'started' })
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
