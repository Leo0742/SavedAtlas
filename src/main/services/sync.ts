import { Api } from 'telegram'
import type { SavedAtlasDatabase } from '../database'
import type { TelegramService } from './telegram'
import type { AnalysisService } from './analysis'

function isoDate(timestamp:number|undefined):string|undefined{return timestamp?new Date(timestamp*1000).toISOString():undefined}
function trimRaw(message: Api.Message): string { return JSON.stringify({ id:message.id,date:message.date,editDate:isoDate(message.editDate),message:message.message,groupedId:message.groupedId?.toString(),media:message.media?.className,peerId:message.peerId?.toJSON?.(),fwdFrom:message.fwdFrom?.toJSON?.() },(_key,value)=>typeof value==='bigint'?value.toString():value).slice(0,16000) }
function mediaType(message:Api.Message):string { const name=message.media?.className?.toLowerCase()??''; if(name.includes('photo'))return'photo';if(name.includes('document')){const mime=(message.media as any)?.document?.mimeType??'';if(mime==='application/pdf')return'pdf';if(mime.startsWith('audio/'))return'audio';if(mime.startsWith('video/'))return'video';return'document'}return'text' }

export class SyncService {
  private cancelled=false; private paused=false
  constructor(private readonly telegram:TelegramService,private readonly db:SavedAtlasDatabase,private readonly analysis?:AnalysisService){}
  pause():void{this.paused=true} resume():void{this.paused=false} cancel():void{this.cancelled=true}
  async run(full=false):Promise<{added:number;updated:number;analyzed:number;skipped:number;review:number;topicsCreated:number;freshnessChecks:number;failed:number}>{
    this.cancelled=false;let offset=full?(this.db.getSyncCheckpoint().currentOffset||0):0;let added=0,updated=0,skipped=0,failed=0;let pages=0
    while(!this.cancelled){while(this.paused)await new Promise(r=>setTimeout(r,250));let page:Api.Message[]
      try{page=await this.telegram.fetchSavedPage(offset,100)}catch(error){const seconds=Number(/FLOOD_WAIT_(\d+)/.exec(error instanceof Error?error.message:'')?.[1]??0);if(seconds>0&&seconds<60){await new Promise(r=>setTimeout(r,seconds*1000));continue}failed++;break}
      if(page.length===0)break
      for(const message of page){const result=this.db.importMessage({telegramMessageId:message.id,date:isoDate(message.date)!,editDate:isoDate(message.editDate)??null,text:message.message??'',caption:'',mediaType:mediaType(message),sourceTitle:message.fwdFrom?'Пересланное сообщение':'Личное сообщение',sourceUsername:null,sourcePublicUrl:null,rawJson:trimRaw(message)});if(result==='added')added++;else if(result==='updated')updated++;else skipped++}
      offset=page[page.length-1].id;this.db.updateSyncCheckpoint(page[0].id,offset,'running');pages++
      if(!full||page.length<100||pages>=500)break
    }
    if(full&&!this.cancelled&&!failed)this.db.markFullSyncComplete();else this.db.updateSyncCheckpoint(0,offset,this.cancelled?'cancelled':'idle')
    const analysis=this.analysis&&added+updated>0?await this.analysis.runPending(50):{analyzed:0,review:0,topicsCreated:0,freshnessChecks:0,failed:0}
    return{added,updated,skipped,...analysis,failed:failed+analysis.failed}
  }
}
