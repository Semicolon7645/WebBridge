import { HttpClient } from '@angular/common/http'
import { computed, Injectable, signal } from '@angular/core'

import _ from 'lodash'
import { ChartData } from 'src-shared/interfaces/search.interface'
import { resolveChartFolderName } from 'src-shared/UtilFunctions'

import { SettingsService } from './settings.service'

import type { Download, DownloadProgress } from '../../../../src-shared/interfaces/download.interface'
@Injectable({
	providedIn: 'root',
})
export class DownloadService {

	readonly downloads = signal<DownloadProgress[]>([])

	// Computed signals for derived state
	readonly downloadCount = computed(() => this.downloads().length)

	readonly completedCount = computed(() =>
		this.downloads().filter(download => download.type === 'done').length
	)

	readonly totalDownloadingPercent = computed(() => {
		const currentDownloads = this.downloads()
		let total = 0
		let count = 0
		for (const download of currentDownloads) {
			if (!download.stale) {
				total += download.percent ?? 0
				count++
			}
		}
		if (this.anyErrorsExist() && total === 0) { return null }
		return count ? total / count : 0
	})

	readonly currentDownloadText = computed(() => {
		const download = this.downloads().find(d => !d.stale && d.type === 'good')
		if (download) {
			return 'Downloading: '
				+ _.truncate(resolveChartFolderName(this.settingsService.chartFolderName, download.chart), { length: 80 })
		} else {
			return ''
		}
	})

	readonly anyErrorsExist = computed(() =>
		this.downloads().find(download => download.type === 'error') ? true : false
	)

	constructor(
		private settingsService: SettingsService,
		private http: HttpClient,
	) {
		if (typeof window.electron !== 'undefined') {
			window.electron.on.downloadQueueUpdate(download => {
				this.applyDownloadUpdate(download)
			})
			return
		}

		const eventSource = new EventSource('/api/events')

		eventSource.addEventListener('downloadQueueUpdate', event => {
			try {
				const download = JSON.parse(
					(event as MessageEvent).data,
				) as DownloadProgress

				this.applyDownloadUpdate(download)
			} catch (error) {
				console.error('Failed to process download update:', error)
			}
		})
	}

	private applyDownloadUpdate(download: DownloadProgress) {
		this.downloads.update(downloads => {
			const downloadIndex = downloads.findIndex(
				d => d.md5 === download.md5,
			)

			if (download.type === 'cancel') {
				return downloads.filter(
					d => d.md5 !== download.md5,
				)
			}

			if (downloadIndex === -1) {
				return [...downloads, download]
			}

			const newDownloads = [...downloads]
			newDownloads[downloadIndex] = {
				...newDownloads[downloadIndex],
				...download,
			}

			return newDownloads
		})
	}

	private sendDownload(data: Download) {
		if (typeof window.electron !== 'undefined') {
			window.electron.emit.download(data)
			return
		}

		this.http.post('/api/download', data).subscribe({
			error: error => {
				console.error('Download request failed:', error)

				this.downloads.update(downloads =>
					downloads.map(download =>
						download.md5 === data.md5
							? {
								...download,
								type: 'error',
								header: 'Download request failed',
								body: String(
									error?.error?.error ??
									error?.message ??
									'Unable to contact the server',
								),
								percent: null,
							}
							: download,
					),
				)
			},
		})
	}

	addDownload(chart: ChartData) {
		const currentDownloads = this.downloads()
		if (!currentDownloads.find(d => d.md5 === chart.md5)) { // Don't download something twice
			if (currentDownloads.every(d => d.type === 'done')) { // Reset overall progress bar if it finished
				this.downloads.update(downloads => downloads.map(d => ({ ...d, stale: true })))
			}
			const newChart = {
				name: chart.name ?? 'Unknown Name',
				artist: chart.artist ?? 'Unknown Artist',
				album: chart.album ?? 'Unknown Album',
				genre: chart.genre ?? 'Unknown Genre',
				year: chart.year ?? 'Unknown Year',
				charter: chart.charter ?? 'Unknown Charter',
			}
			this.downloads.update(downloads => [...downloads, {
				md5: chart.md5,
				chart: newChart,
				header: 'Waiting for other downloads to finish...',
				body: '',
				percent: 0,
				type: 'good',
				isPath: false,
			}])
			this.sendDownload({
				action: 'add',
				md5: chart.md5,
				hasVideoBackground: chart.hasVideoBackground,
				chart: newChart,
			})
		}
	}

	cancelDownload(md5: string) {
		this.sendDownload({ action: 'remove', md5 })
	}

	cancelAllCompleted() {
		const currentDownloads = this.downloads()
		for (const download of currentDownloads) {
			if (download.type === 'done') {
				this.sendDownload({ action: 'remove', md5: download.md5 })
			}
		}
		this.downloads.update(downloads => downloads.filter(d => d.type !== 'done'))
	}

	retryDownload(md5: string) {
		this.downloads.update(downloads => {
			const index = downloads.findIndex(d => d.md5 === md5)
			if (index !== -1) {
				const newDownloads = [...downloads]
				newDownloads[index] = {
					...newDownloads[index],
					type: 'good',
					header: 'Waiting to retry...',
					body: '',
					isPath: false,
					percent: 0,
				}
				this.sendDownload({ action: 'retry', md5 })
				return newDownloads
			}
			return downloads
		})
	}
}
