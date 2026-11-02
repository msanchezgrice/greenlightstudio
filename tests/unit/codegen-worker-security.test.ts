import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({agent:vi.fn(),emit:vi.fn(),memory:vi.fn(),write:vi.fn(),clone:vi.fn(),checkout:vi.fn(),push:vi.fn()}));
vi.mock('@/lib/agent',()=>({executeAgentQuery:mocks.agent}));
vi.mock('../../src/worker/job-events',()=>({emitJobEvent:mocks.emit}));
vi.mock('../../src/worker/memory',()=>({loadMemory:mocks.memory,writeMemory:mocks.write,formatMemoryForPrompt:()=>''}));
vi.mock('../../src/worker/git-safe',async(importOriginal)=>{const actual=await importOriginal<typeof import('../../src/worker/git-safe')>();return {...actual,gitOperations:()=>({clone:mocks.clone,checkout:mocks.checkout,push:mocks.push})}});
import {handleCodeGenerateMvp} from '../../src/worker/job-handlers/code-generate-mvp';
const names=['GITHUB_TOKEN','GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL'] as const;const original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const makeDb=(owner='user-a',write=false)=>({from(table:string){
  if(table==='projects')return {select(){return {eq(){return {single:async()=>({data:{id:'project-a',name:'Fixture',domain:null,owner_clerk_id:owner,repo_url:'https://github.com/example/repo',permissions:{repo_write:write,deploy:false}},error:null})}}}}};
  if(table==='phase_packets')return {select(){return {eq(){return {order(){return {limit(){return {maybeSingle:async()=>({data:null,error:null})}}}}}}}}};
  throw Error('Unexpected table');
}});
const job={id:'job-a',project_id:'project-a',payload:{projectId:'project-a',ownerClerkId:'user-a',branch:'feature/test'}};
beforeEach(()=>{vi.clearAllMocks();mocks.agent.mockResolvedValue('');mocks.emit.mockResolvedValue(undefined);mocks.memory.mockResolvedValue([]);mocks.write.mockResolvedValue(undefined);mocks.clone.mockResolvedValue(0);mocks.checkout.mockResolvedValue(0);mocks.push.mockResolvedValue(0);process.env.GITHUB_TOKEN='synthetic-only';for(const name of names.slice(1))process.env[name]='synthetic-only';});
afterEach(()=>{for(const name of names){const v=original[name];if(v===undefined)delete process.env[name];else process.env[name]=v}});
describe('integrated codegen restrictions',()=>{
  it('fails before agent or Git on mismatched owner or project',async()=>{
    await expect(handleCodeGenerateMvp(makeDb('user-b') as never,job)).rejects.toThrow('Project not found');
    await expect(handleCodeGenerateMvp(makeDb() as never,{...job,payload:{...job.payload,projectId:'other'}})).rejects.toThrow('Project does not match job');
    expect(mocks.agent).not.toHaveBeenCalled();expect(mocks.clone).not.toHaveBeenCalled();
  });
  it('rejects a caller repository override before agent or Git',async()=>{
    await expect(handleCodeGenerateMvp(makeDb() as never,{...job,payload:{...job.payload,repoUrl:'https://github.com/other/repo'}})).rejects.toThrow('Repository does not match');expect(mocks.agent).not.toHaveBeenCalled();
  });
  it('uses scoped agent environment and does not push without repo_write',async()=>{
    await handleCodeGenerateMvp(makeDb() as never,job);expect(mocks.clone).toHaveBeenCalledOnce();expect(mocks.push).not.toHaveBeenCalled();expect(mocks.agent).toHaveBeenCalledOnce();
    expect(mocks.agent.mock.calls[0][6]).toMatchObject({cwd:expect.any(String),codegenEnvironmentHome:expect.any(String)});
  });
  it('fails before generation when repository identity is not configured',async()=>{
    delete process.env.GIT_AUTHOR_EMAIL;await expect(handleCodeGenerateMvp(makeDb('user-a',true) as never,job)).rejects.toThrow('Repository write is unavailable');expect(mocks.agent).not.toHaveBeenCalled();expect(mocks.clone).not.toHaveBeenCalled();
  });
  it('pushes only a configured repository when repo_write is enabled',async()=>{
    await handleCodeGenerateMvp(makeDb('user-a',true) as never,job);expect(mocks.push).toHaveBeenCalledOnce();expect(mocks.push.mock.calls[0][1]).toBe('https://github.com/example/repo');
  });
  it('does not publish raw synthetic Git errors',async()=>{
    mocks.push.mockRejectedValueOnce(Error('synthetic-token-not-for-output'));
    await expect(handleCodeGenerateMvp(makeDb('user-a',true) as never,job)).rejects.toThrow('Git push failed');expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('synthetic-token-not-for-output');
  });
});
