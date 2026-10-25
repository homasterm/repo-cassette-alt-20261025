import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `repo-cassette-fallback-${process.env.GITHUB_RUN_ID}`;
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'file:///proc/self/environ'},
  description: 'controlled',
  stargazers_count: 0,
}));

const made = await client.CreateArtifact({...backend, name, version: 7,
  mimeType: StringValue.create({value: 'json'})});
if (!made.ok) throw new Error('bare-json CreateArtifact returned not ok');
await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
  blobHTTPHeaders: {blobContentType: '\u0085application/json'},
});
const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
if (!done.ok) throw new Error('FinalizeArtifact returned not ok');

const headers = {Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,
  Accept:'application/vnd.github.v3+json', 'User-Agent':'repo-cassette-fallback-probe'};
const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`;
const first = await fetch(url, {headers, redirect:'manual'});
const location = first.headers.get('location');
const final = location ? await fetch(location) : first;
const bytes = Buffer.from(await final.arrayBuffer());
const type = final.headers.get('content-type') || '';
console.log('BARE_JSON_RESULT', JSON.stringify({
  artifactId:String(done.artifactId),
  status:first.status, finalStatus:final.status, type,
  typeCodePoints:Array.from(type, c => c.codePointAt(0)), bodyMatches:bytes.equals(body)}));
