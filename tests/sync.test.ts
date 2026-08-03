import { describe,expect,it } from 'vitest'
import { mkdtempSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Api } from 'telegram'
import { SavedAtlasDatabase } from '../src/main/database'
import { SyncService } from '../src/main/services/sync'

function message(id:number,text:string){return new Api.Message({id,peerId:new Api.PeerUser({userId:BigInt(1) as any}),date:Math.floor(Date.now()/1000),message:text,out:false,mentioned:false,mediaUnread:false,silent:false,post:false,fromScheduled:false,legacy:false,editHide:false,pinned:false,noforwards:false} as any)}
describe('Telegram pagination and incremental sync',()=>{
  it('imports pages and skips unchanged messages on the next run',async()=>{const dir=mkdtempSync(join(tmpdir(),'savedatlas-sync-'));const db=new SavedAtlasDatabase(join(dir,'db.sqlite'));let calls=0;const telegram={fetchSavedPage:async(offset:number)=>{calls++;if(offset===0)return[message(2,'Курс по ИИ'),message(1,'Личная заметка')];return[]}} as any;const sync=new SyncService(telegram,db);const first=await sync.run(true);expect(first.added).toBe(2);expect(calls).toBe(1);const second=await sync.run(false);expect(second.skipped).toBe(2);db.close();rmSync(dir,{recursive:true,force:true})})
  it('counts a temporary Telegram error without corrupting the checkpoint',async()=>{const dir=mkdtempSync(join(tmpdir(),'savedatlas-sync-'));const db=new SavedAtlasDatabase(join(dir,'db.sqlite'));const sync=new SyncService({fetchSavedPage:async()=>{throw new Error('NETWORK')}} as any,db);expect((await sync.run(false)).failed).toBe(1);expect(db.getSyncCheckpoint().lastKnownMessageId).toBe(0);db.close();rmSync(dir,{recursive:true,force:true})})
})
