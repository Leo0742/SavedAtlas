import type { JobProgress } from '../../shared/contracts'
import type { AnalysisJob, SavedAtlasDatabase } from '../database'
import type { RouterAIService } from './routerai'
import { redactTechnicalDetails } from './security'
import type { z } from 'zod'
import type { classificationResponseSchema, freshnessResponseSchema } from '../../shared/contracts'

export class JobRunner {
  private paused = false
  private cancelled = false
  private active: Promise<void> | null = null
  private state: JobProgress['state'] = 'idle'
  constructor(private readonly db: SavedAtlasDatabase, private readonly router: RouterAIService, private readonly options: { sleep?: (milliseconds: number) => Promise<void>; onProgress?: (progress: JobProgress) => void } = {}) {}

  getProgress(): JobProgress { return { ...this.db.getJobProgress(), state: this.state } }
  pause(): void { this.paused = true; this.state = 'paused'; this.emit() }
  resume(): Promise<void> { this.paused = false; return this.start() }
  cancel(): void { this.cancelled = true; this.paused = false; this.state = 'cancelled'; this.db.cancelPendingJobs(); this.emit() }
  start(): Promise<void> {
    if (this.active) return this.active
    this.cancelled = false; this.state = 'running'; this.emit()
    this.active = this.run().finally(() => { this.active = null; if (!this.cancelled && !this.paused) this.state = 'idle'; this.emit() })
    return this.active
  }

  private async run(): Promise<void> {
    while (!this.cancelled) {
      if (this.paused) { await this.sleep(50); continue }
      const concurrency = this.db.getSettings().jobConcurrency
      const jobs = Array.from({ length: concurrency }, () => this.db.claimJob()).filter((job): job is AnalysisJob => Boolean(job))
      if (!jobs.length) {
        const delay = this.db.nextJobDelayMs(); if (delay == null) return
        await this.sleep(Math.min(Math.max(delay, 10), 1000)); continue
      }
      await Promise.all(jobs.map((job) => this.execute(job))); this.emit()
    }
  }

  private async execute(job: AnalysisJob): Promise<void> {
    try {
      const message = this.db.getMessageForAnalysis(job.messageId)
      if (!message) { this.db.completeJob(job.id); return }
      if (job.jobType === 'classification') {
        const taxonomy = this.db.getTaxonomy()
        const response = await this.router.classify({ ...message, categories: taxonomy.categories, topics: taxonomy.topics }, (operation, attempt, outcome, code) => this.db.recordRouterAttempt(job.messageId, operation, attempt, outcome, code))
        this.db.applyClassification(job.messageId, response.value as z.infer<typeof classificationResponseSchema>, { classificationJobId: job.id })
      } else if (job.jobType === 'freshness') {
        const input = this.db.getFreshnessInput(job.messageId)
        if (input) {
          const response = await this.router.checkFreshness({ ...input, maxResults: this.db.getSettings().freshnessMaxResults }, (operation, attempt, outcome, code) => this.db.recordRouterAttempt(job.messageId, operation, attempt, outcome, code))
          this.db.applyFreshness(job.messageId, response.value as z.infer<typeof freshnessResponseSchema>, response.annotations)
        }
      } else if (job.jobType === 'fts') this.db.reindexMessage(job.messageId)
      else if (job.jobType === 'media') throw new Error('MEDIA_PROVIDER_UNAVAILABLE')
      this.db.completeJob(job.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const temporary = /429|5\d\d|timeout|network|ECONN|FLOOD_WAIT|TEMPORARY/i.test(message)
      this.db.failJob(job, temporary ? 'TEMPORARY' : 'PERMANENT', redactTechnicalDetails(error), temporary)
    }
  }
  private sleep(milliseconds: number): Promise<void> { return this.options.sleep?.(milliseconds) ?? new Promise((resolve) => setTimeout(resolve, milliseconds)) }
  private emit(): void { this.options.onProgress?.(this.getProgress()) }
}
