
import { Download } from '../../src-shared/interfaces/download.interface.js'
import { tempPath } from '../../src-shared/Paths.js'
import { emitIpcEvent } from '../main.js'
import { DownloadQueue } from './download/DownloadQueue.js'
import { getSettings } from './SettingsHandler.ipc.js'

const downloadQueue: DownloadQueue = new DownloadQueue(emitIpcEvent, {
	getSettings,
	tempPath,
})

export async function download(data: Download) {
	switch (data.action) {
		case 'add':
			downloadQueue.add(data.md5, data.hasVideoBackground!, data.chart!)
			break
		case 'retry':
			downloadQueue.retry(data.md5)
			break
		case 'remove':
			downloadQueue.remove(data.md5)
			break
	}
}
