import type { SavedAtlasDatabase } from '../database'
import type { RouterAIService } from './routerai'
import { redactTechnicalDetails } from './security'

export class AnalysisService{
  constructor(private readonly db:SavedAtlasDatabase,private readonly router:RouterAIService){}
  async runPending(limit=50):Promise<{analyzed:number;review:number;topicsCreated:number;freshnessChecks:number;failed:number}>{
    let analyzed=0,review=0,topicsCreated=0,freshnessChecks=0,failed=0
    for(const message of this.db.getPendingMessages(limit)){
      try{const taxonomy=this.db.getTaxonomy();const classification=await this.router.classify({...message,categories:taxonomy.categories,topics:taxonomy.topics});const applied=this.db.applyClassification(message.id,classification);analyzed++;if(applied.needsReview)review++;if(applied.topicCreated)topicsCreated++
        if(classification.freshness_check_needed&&classification.suggested_search_query){try{const freshness=await this.router.checkFreshness({content:message.content,query:classification.suggested_search_query,maxResults:5});this.db.applyFreshness(message.id,freshness);freshnessChecks++}catch{review++}}
      }catch(error){failed++;this.db.markAnalysisFailed(message.id,redactTechnicalDetails(error))}
    }
    return{analyzed,review,topicsCreated,freshnessChecks,failed}
  }
}
