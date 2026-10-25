import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `delete-refinalize-${process.env.GITHUB_RUN_ID}.json`;
const placeholder = Buffer.from('{}');
const made = await client.CreateArtifact({
  ...backend, name, version: 7,
  mimeType: StringValue.create({value: 'application/octet-stream'}),
});
if (!made.ok) throw new Error('create-not-ok');
const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
await block.uploadData(placeholder, {blobHTTPHeaders: {blobContentType: 'application/octet-stream'}});
const firstDone = await client.FinalizeArtifact({...backend, name, size: String(placeholder.length)});
if (!firstDone.ok) throw new Error('first-finalize-not-ok');
const repository = `${process.env.GITHUB_REPOSITORY}/actions/artifacts/${firstDone.artifactId}/zip`;
const body = Buffer.from(JSON.stringify({
  full_name: repository,
  owner: {login: 'control', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4'},
  description: 'delete-refinalize-marker',
  stargazers_count: 0,
}));
await block.uploadData(body, {blobHTTPHeaders: {blobContentType: '\u0085application/json'}});
const deleted = await client.DeleteArtifact({...backend, name});
let rewrite;
try {
  await block.uploadData(body, {blobHTTPHeaders: {blobContentType: '\u0085application/json'}});
  rewrite = {ok: true};
} catch (error) {
  rewrite = {error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 160)};
}

const timeout = new Promise(resolve => setTimeout(() => resolve({timeout: true}), 10000));
const finalizePromise = client.FinalizeArtifact({...backend, name, size: String(body.length)})
  .then(value => ({ok: value.ok, artifactId: String(value.artifactId)}))
  .catch(error => ({error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 220)}));
const second = await Promise.race([finalizePromise, timeout]);
const candidateIds = [String(firstDone.artifactId)];
if (second.artifactId && !candidateIds.includes(second.artifactId)) candidateIds.push(second.artifactId);
const rows = [];
for (const id of candidateIds) {
  const first = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${id}/zip`,
    {headers: {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
               Accept: 'application/vnd.github.v3+json',
               'User-Agent': 'repo-cassette-delete-refinalize-probe'},
     redirect: 'manual'},
  );
  let final = first;
  const location = first.headers.get('location');
  if (location) final = await fetch(location);
  const bytes = Buffer.from(await final.arrayBuffer());
  const type = final.headers.get('content-type') || '';
  rows.push({id, firstStatus: first.status, finalStatus: final.status,
             typeCodePoints: Array.from(type, c => c.codePointAt(0)),
             bodyMatches: bytes.equals(body), size: bytes.length});
}
console.log('DELETE_REFINALIZE_RESULT', JSON.stringify({
  firstArtifactId: String(firstDone.artifactId), deletedOk: deleted.ok, rewrite, second, rows,
}));
process.exit(0);
