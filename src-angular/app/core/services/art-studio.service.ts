/**
 * Bridge Art Studio Module - Angular Service
 */

import { HttpClient } from '@angular/common/http'
import { Injectable, signal } from '@angular/core'

import { firstValueFrom } from 'rxjs'

import { AlbumArtResult, ArtDownloadOptions, ArtDownloadProgress, BackgroundGenerateOptions, ChartArtMatch } from '../../../../src-shared/interfaces/art-studio.interface.js'

@Injectable({
	providedIn: 'root',
})
export class ArtStudioService {
	readonly downloadProgress = signal<ArtDownloadProgress | null>(null)
	readonly isProcessing = signal<boolean>(false)

	constructor(private http: HttpClient) {
		this.setupIpcListeners()
	}

	private setupIpcListeners(): void {
		if (typeof window === 'undefined' || !window.electron) {
			return
		}

		window.electron.on.artDownloadProgress((progress: ArtDownloadProgress) => {
			this.downloadProgress.set(progress)

			if (progress.phase === 'complete' || progress.phase === 'error') {
				this.isProcessing.set(false)
			} else {
				this.isProcessing.set(true)
			}
		})
	}

	async searchAlbumArt(artist: string, album: string): Promise<AlbumArtResult[]> {
		try {
			return await window.electron.invoke.artSearchAlbumArt({ artist, album })
		} catch (err) {
			console.error('Album art search failed:', err)
			throw err
		}
	}

	async downloadImage(options: ArtDownloadOptions): Promise<string> {
		this.isProcessing.set(true)
		this.downloadProgress.set({
			phase: 'downloading',
			percent: 0,
			message: 'Starting download...',
			chartId: options.chartId,
		})

		try {
			return await window.electron.invoke.artDownloadImage(options)
		} catch (err) {
			this.downloadProgress.set({
				phase: 'error',
				percent: 0,
				message: `Error: ${err}`,
				chartId: options.chartId,
			})
			throw err
		} finally {
			this.isProcessing.set(false)
		}
	}

	async generateBackground(options: BackgroundGenerateOptions): Promise<string> {
		this.isProcessing.set(true)
		this.downloadProgress.set({
			phase: 'processing',
			percent: 0,
			message: 'Generating background...',
			chartId: options.chartId,
		})

		try {
			return await window.electron.invoke.artGenerateBackground(options)
		} catch (err) {
			this.downloadProgress.set({
				phase: 'error',
				percent: 0,
				message: `Error: ${err}`,
				chartId: options.chartId,
			})
			throw err
		} finally {
			this.isProcessing.set(false)
		}
	}

	async getChartsMissingAlbumArt(limit: number = 10000): Promise<ChartArtMatch[]> {
		try {
			return await window.electron.invoke.artGetChartsMissingAlbumArt(limit)
		} catch (err) {
			console.error('Failed to get charts missing album art:', err)
			return []
		}
	}

	async getChartsMissingBackground(limit: number = 10000): Promise<ChartArtMatch[]> {
		try {
			return await window.electron.invoke.artGetChartsMissingBackground(limit)
		} catch (err) {
			console.error('Failed to get charts missing background:', err)
			return []
		}
	}

	async checkChartAssets(chartId: number): Promise<{ hasAlbumArt: boolean; hasBackground: boolean; albumArtPath?: string; backgroundPath?: string }> {
		try {
			return await window.electron.invoke.artCheckChartAssets(chartId)
		} catch (err) {
			console.error('Failed to check chart assets:', err)
			return { hasAlbumArt: false, hasBackground: false }
		}
	}

	async batchFetchAlbumArt(chartIds: number[]): Promise<{ success: number; failed: number; skipped: number }> {
		this.isProcessing.set(true)
		try {
			return await window.electron.invoke.artBatchFetchAlbumArt(chartIds)
		} finally {
			this.isProcessing.set(false)
		}
	}

	async batchGenerateBackgrounds(chartIds: number[]): Promise<{ success: number; failed: number; skipped: number }> {
		this.isProcessing.set(true)
		try {
			return await window.electron.invoke.artBatchGenerateBackgrounds(chartIds)
		} finally {
			this.isProcessing.set(false)
		}
	}

	async deleteAlbumArt(chartId: number): Promise<boolean> {
		try {
			const result = await window.electron.invoke.artDeleteAlbumArt(chartId)
			return result.success
		} catch (err) {
			console.error('Failed to delete album art:', err)
			return false
		}
	}

	private async getChartArtDataUrl(
		chartPath: string,
		type: 'album' | 'background',
	): Promise<string | null> {
		try {
			if (window.electron) {
				return type === 'album'
					? await window.electron.invoke.artGetAlbumArtDataUrl({ chartPath })
					: await window.electron.invoke.artGetBackgroundDataUrl({ chartPath })
			}

			const blob = await firstValueFrom(
				this.http.get('/api/catalog/chart-art', {
					params: { chartPath, type },
					responseType: 'blob',
				}),
			)

			return await new Promise<string>((resolve, reject) => {
				const reader = new FileReader()
				reader.onload = () => {
					if (typeof reader.result === 'string') {
						resolve(reader.result)
					} else {
						reject(new Error('Failed to read artwork'))
					}
				}
				reader.onerror = () => reject(reader.error)
				reader.readAsDataURL(blob)
			})
		} catch (err) {
			console.error(`Failed to get ${type} data URL:`, err)
			return null
		}
	}

	async getAlbumArtDataUrl(chartPath: string): Promise<string | null> {
		return this.getChartArtDataUrl(chartPath, 'album')
	}

	async getBackgroundDataUrl(chartPath: string): Promise<string | null> {
		return this.getChartArtDataUrl(chartPath, 'background')
	}
}
