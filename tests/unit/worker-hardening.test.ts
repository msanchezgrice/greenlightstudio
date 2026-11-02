import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { githubRepository, gitBranch, gitOperations, runGit, type GitOptions } from '../../src/worker/git-safe';
import { codegenAgentEnvironment } from '../../src/lib/agent-env';
import { QuarantinedTimeout, runWithTimeoutQuarantine, quarantineAttempt } from '../../src/worker/job-timeout';

const dirs:string[]=[];
afterEach(async()=>{for (const d of dirs.splice(0)) await rm(d,{recursive:true,force:true});});
describe('worker Git safety',()=>{
  it('rejects credential-bearing and non-GitHub URLs and hostile refs',()=>{
    for(const url of ['https://user:fake-token@github.com/a/repo','https://github.com.evil/a/repo','https://github.com/a/repo?token=fake','file:///tmp/x','https://github.com/a/repo/extra']) expect(()=>githubRepository(url)).toThrow();
    for(const branch of ['--force','x;touch bad','x$(bad)','x..y','a//b','a/.hidden','a/test.lock','a/']) expect(()=>gitBranch(branch)).toThrow();
    expect(githubRepository('https://github.com/example/repo.git')).toBe('https://github.com/example/repo.git');
  });
  it('uses argument arrays and no force push for a validated repo',async()=>{
    const calls:Array<{args:string[];opts:GitOptions}>=[]; const git=gitOperations(async(args,opts)=>{calls.push({args,opts});return args[0]==='diff'?1:0});
    await git.clone('https://github.com/example/repo','/synthetic/work','fake-only');
    await git.checkout('/synthetic/work','feature/x');
    await git.push('/synthetic/work','https://github.com/example/repo','feature/x','fake-only');
    expect(calls.map(c=>c.args[0])).toEqual(['clone','checkout','add','diff','commit','push']);
    expect(JSON.stringify(calls.map(c=>c.args))).not.toContain('fake-only');
    expect(calls.at(-1)?.args).toEqual(['push','https://github.com/example/repo','feature/x']);
    expect(calls.flatMap(c=>c.args)).not.toContain('--force');
  });
  it('never persists token or subprocess output on a fake failing git process',async()=>{
    const d=await mkdtemp(path.join(os.tmpdir(),'greenlight-test-'));dirs.push(d);
    const oldPath=process.env.PATH, oldHome=process.env.HOME;
    await writeFile(path.join(d,'git'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/args"\n[ -n "$GIT_CONFIG_VALUE_0" ] && printf yes > "$HOME/auth-present"\nprintf "synthetic stderr" >&2\nexit 7\n',{mode:0o700});
    process.env.PATH=d;process.env.HOME=d;
    try {
      const token='synthetic-token-not-a-credential';
      await expect(runGit(['clone','https://github.com/example/repo','workspace'],{token})).rejects.toThrow('Git operation failed');
      const args=await readFile(path.join(d,'args'),'utf8');expect(args).not.toContain(token);expect(await readFile(path.join(d,'auth-present'),'utf8')).toBe('yes');
    } finally {process.env.PATH=oldPath;process.env.HOME=oldHome;}
  });
  it('does not pass unrelated environment secrets to code generation',()=>{
    const source={NODE_ENV:'test',PATH:'/synthetic',ANTHROPIC_API_KEY:'fake-agent-key',GITHUB_TOKEN:'fake-git-key',SUPABASE_SERVICE_ROLE_KEY:'fake-db-key'} as NodeJS.ProcessEnv;
    const out=codegenAgentEnvironment(source,'/synthetic/home');expect(out.ANTHROPIC_API_KEY).toBe('fake-agent-key');expect(out.GITHUB_TOKEN).toBeUndefined();expect(out.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});
describe('timeout quarantine',()=>{
  it('quarantines once, holds the slot until the old handler settles, and never retries it',async()=>{
    let finish!:()=>void;const work=new Promise<void>(resolve=>{finish=resolve});let writes=0,done=false;
    const run=runWithTimeoutQuarantine(()=>work,5,async()=>{writes++}).catch(error=>{done=true;return error});
    await new Promise(resolve=>setTimeout(resolve,20));expect(writes).toBe(1);expect(done).toBe(false);
    finish();const error=await run;expect(error).toBeInstanceOf(QuarantinedTimeout);expect(error.quarantineFailed).toBe(false);
  });
  it('bounds failed quarantine and unsettled work without retrying it',async()=>{
    const never=new Promise<void>(()=>{});const result=await runWithTimeoutQuarantine(()=>never,5,async()=>{throw Error('synthetic DB failure')},10,10).catch(error=>error);
    expect(result).toBeInstanceOf(QuarantinedTimeout);expect(result.quarantineFailed).toBe(true);expect(result.workUnsettled).toBe(true);
  });
  it('bounds a stalled quarantine request and unsettled work',async()=>{
    const never=new Promise<void>(()=>{});const result=await runWithTimeoutQuarantine(()=>never,5,()=>never,10,10).catch(error=>error);
    expect(result.quarantineFailed).toBe(true);expect(result.workUnsettled).toBe(true);
  });
  it('does not quarantine successful or promptly rejected work',async()=>{
    let writes=0;await runWithTimeoutQuarantine(async()=>{},100,async()=>{writes++});
    await expect(runWithTimeoutQuarantine(async()=>{throw Error('synthetic')},100,async()=>{writes++})).rejects.toThrow('synthetic');expect(writes).toBe(0);
  });
});

it('quarantine updates only the same running worker and attempt; lost claim fails closed',async()=>{
  const filters:Record<string,unknown>={};let written:Record<string,unknown>={};let match=true;
  const chain={eq(key:string,value:unknown){filters[key]=value;return chain},async select(){return {data:match?[{id:'job'}]:[],error:null}}};
  const db={from(table:string){expect(table).toBe('agent_jobs');return {update(value:Record<string,unknown>){written=value;return chain}}}};
  const client=db as unknown as import('@supabase/supabase-js').SupabaseClient;
  await quarantineAttempt(client,{id:'job',attempts:3,locked_at:'2026-01-01T00:00:00Z',locked_by:'worker'},'worker');expect(filters).toEqual({id:'job',status:'running',locked_by:'worker',attempts:3,locked_at:'2026-01-01T00:00:00Z'});expect(written.status).toBe('failed');expect(written.last_error).toContain('uncertain');
  match=false;await expect(quarantineAttempt(client,{id:'job',attempts:3,locked_at:'2026-01-01T00:00:00Z',locked_by:'worker'},'worker')).rejects.toThrow('Job quarantine failed');
});

it('stale fallback cannot requeue a quarantined or newly claimed attempt',async()=>{
  const {reclaimSnapshots}=await import('../../src/worker/reclaim-fallback');
  type Row={id:string;status:string;attempts:number;max_attempts:number;locked_at:string|null;locked_by:string|null;last_error?:string};
  const initial:Row={id:'job',status:'running',attempts:1,max_attempts:3,locked_at:'2026-01-01T00:00:00Z',locked_by:'worker-a'};
  const snapshot={id:initial.id,attempts:initial.attempts,max_attempts:initial.max_attempts,locked_at:initial.locked_at!,locked_by:initial.locked_by};
  let row:Row={...initial,status:'failed',locked_at:null,locked_by:null,last_error:'outcome uncertain'};
  const db={from(){return {update(payload:Record<string,unknown>){
    const filters:Record<string,unknown>={};let cutoff='';const query={
      eq(k:string,v:unknown){filters[k]=v;return query},is(k:string,v:unknown){filters[k]=v;return query},lt(_k:string,v:string){cutoff=v;return query},
      async select(){const matched=Object.entries(filters).every(([k,v])=>row[k as keyof Row]===v)&&!!row.locked_at&&row.locked_at<cutoff;if(matched)row={...row,...payload} as Row;return {data:matched?[{id:row.id}]:[],error:null}}};return query;
  }}}};
  const client=db as unknown as import('@supabase/supabase-js').SupabaseClient;
  expect(await reclaimSnapshots(client,[snapshot],'2026-01-02T00:00:00Z')).toBe(0);expect(row.status).toBe('failed');expect(row.last_error).toBe('outcome uncertain');
  row={...initial,attempts:2,locked_by:'worker-b',locked_at:'2026-01-01T01:00:00Z'};
  expect(await reclaimSnapshots(client,[snapshot],'2026-01-02T00:00:00Z')).toBe(0);expect(row.status).toBe('running');expect(row.attempts).toBe(2);
  row={...initial,max_attempts:1};expect(await reclaimSnapshots(client,[snapshot],'2026-01-02T00:00:00Z')).toBe(0);expect(row.status).toBe('running');
  row={...initial};expect(await reclaimSnapshots(client,[snapshot],'2026-01-02T00:00:00Z')).toBe(1);expect(row.status).toBe('failed');expect(row.last_error).toContain('uncertain');
});

it('success and error transitions reject stale worker, changed attempt or renewed lock',async()=>{
  const {transitionOwnedJob}=await import('../../src/worker/job-timeout');
  const base={id:'job',status:'running',attempts:1,locked_at:'2026-01-01T00:00:00Z',locked_by:'worker-a'};let row={...base};
  const db={from(){return {update(payload:Record<string,unknown>){const filters:Record<string,unknown>={};const query={eq(k:string,v:unknown){filters[k]=v;return query},async select(){const matches=Object.entries(filters).every(([k,v])=>row[k as keyof typeof row]===v);if(matches)row={...row,...payload};return {data:matches?[{id:row.id}]:[],error:null}}};return query}}}};
  const client=db as unknown as import('@supabase/supabase-js').SupabaseClient;const claim={id:'job',attempts:1,locked_at:base.locked_at,locked_by:'worker-a'};
  for(const payload of [{status:'completed'},{status:'queued'},{status:'failed'}]) {
    row={...base,status:'failed'};expect(await transitionOwnedJob(client,claim,'worker-a',payload)).toBe(false);expect(row.status).toBe('failed');
    row={...base,attempts:2,locked_by:'worker-b'};expect(await transitionOwnedJob(client,claim,'worker-a',payload)).toBe(false);expect(row.status).toBe('running');
    row={...base,locked_at:'2026-01-01T00:01:00Z'};expect(await transitionOwnedJob(client,claim,'worker-a',payload)).toBe(false);
    row={...base};expect(await transitionOwnedJob(client,claim,'worker-a',payload)).toBe(true);expect(row.status).toBe(payload.status);
  }
});

it('timeout exits bounded grace only after successful quarantine',async()=>{
  const {runWithTimeoutQuarantine,QuarantinedTimeout}=await import('../../src/worker/job-timeout');let writes=0;
  const never=new Promise<void>(()=>{});const result=await runWithTimeoutQuarantine(()=>never,5,async()=>{writes++},10).catch(e=>e);
  expect(writes).toBe(1);expect(result).toBeInstanceOf(QuarantinedTimeout);expect(result.quarantineFailed).toBe(false);expect(result.workUnsettled).toBe(true);
});
it('serial worker config ignores unsafe larger claim and concurrency',async()=>{
  const {getWorkerConfig}=await import('../../src/worker/worker-config');const config=getWorkerConfig();expect(config.claimBatch).toBe(1);expect(config.concurrency).toBe(1);expect(config.heavyConcurrency).toBe(1);
});

it('handler failures become terminal uncertain outcomes rather than automatic retries',async()=>{
 const {uncertainFailurePayload}=await import('../../src/worker/job-timeout');const value=uncertainFailurePayload(new Date('2030-01-01T00:00:00Z'));expect(value.status).toBe('failed');expect(value.last_error).toContain('uncertain');expect(value).not.toHaveProperty('run_after');
});
