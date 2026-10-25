import { BlobClient } from '@azure/storage-blob';
import { CreateArtifactRequest, CreateArtifactResponse } from './node_modules/@actions/artifact/lib/generated/results/api/v1/artifact.js';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';

const base = process.env.ACTIONS_RESULTS_URL;
const token = process.env.ACTIONS_RUNTIME_TOKEN;
const backend = getBackendIdsFromToken();
const name = `duplicate-mime-${process.env.GITHUB_RUN_ID}`;

function varint(n) {
  const out = [];
  do { let b=n&0x7f; n>>>=7; if(n)b|=0x80; out.push(b); } while(n);
  return Buffer.from(out);
}
function field(number, bytes) {
  return Buffer.concat([varint((number<<3)|2), varint(bytes.length), bytes]);
}
function wrapper(text) { return field(1, Buffer.from(text, 'utf8')); }

const baseRequest = Buffer.from(CreateArtifactRequest.toBinary(CreateArtifactRequest.create({
  ...backend, name, version: 7,
})));
const request = Buffer.concat([
  baseRequest,
  field(6, wrapper('\u0085application/json')),
  field(6, wrapper('application/octet-stream')),
]);
const url = new URL('/twirp/github.actions.results.api.v1.ArtifactService/CreateArtifact', base);
const response = await fetch(url, {method:'POST', headers:{Authorization:`Bearer ${token}`,
  'Content-Type':'application/protobuf','User-Agent':'repo-cassette-duplicate-mime-probe'}, body:request});
const bytes = Buffer.from(await response.arrayBuffer());
const result = {status: response.status};
if (response.ok) {
  const made = CreateArtifactResponse.fromBinary(bytes);
  const body = Buffer.from('{}');
  const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
  await block.uploadData(body, {blobHTTPHeaders:{blobContentType:'\u0085application/json'}});
  const done = await internalArtifactTwirpClient({maxAttempts:1}).FinalizeArtifact({...backend,name,size:String(body.length)});
  const first = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`,
    {headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github.v3+json',
              'User-Agent':'repo-cassette-duplicate-mime-probe'},redirect:'manual'});
  const final = await fetch(first.headers.get('location'));
  const type = final.headers.get('content-type') || '';
  Object.assign(result,{artifactId:String(done.artifactId),typeCodePoints:Array.from(type,c=>c.codePointAt(0))});
} else {
  result.body = bytes.toString('utf8').replace(/[\r\n]+/g,' ').slice(0,300);
}
console.log('DUPLICATE_MIME_RESULT', JSON.stringify(result));
