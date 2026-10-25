import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `repo-cassette-postfinal-${process.env.GITHUB_RUN_ID}`;
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'file:///proc/self/environ'},
  description: 'controlled',
  stargazers_count: 0,
}));

async function create(version, mimeType) {
  const made = await client.CreateArtifact({
    ...backend,
    name,
    version,
    mimeType: StringValue.create({value: mimeType}),
  });
  if (!made.ok) throw new Error(`CreateArtifact v${version} returned not ok`);
  await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
    blobHTTPHeaders: {blobContentType: 'application/json'},
  });
  return made;
}

async function finalize() {
  const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
  if (!done.ok) throw new Error('FinalizeArtifact returned not ok');
  return String(done.artifactId);
}

async function observe(artifactId, phase) {
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'repo-cassette-postfinal-probe',
  };
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${artifactId}/zip`;
  const first = await fetch(url, {headers, redirect: 'manual'});
  const location = first.headers.get('location');
  const final = location ? await fetch(location) : first;
  const bytes = Buffer.from(await final.arrayBuffer());
  const type = final.headers.get('content-type') || '';
  return {phase, status:first.status, finalStatus:final.status, type,
    typeCodePoints:Array.from(type, c => c.codePointAt(0)), bodyMatches:bytes.equals(body)};
}

await create(7, 'application/json');
const firstId = await finalize();
const observations = [await observe(firstId, 'v7-finalized')];
let secondCreateError = '';
let secondId = '';
try {
  await create(6, '\u0085application/json');
  observations.push(await observe(firstId, 'v6-created-not-finalized'));
  secondId = await finalize();
  observations.push(await observe(firstId, 'v6-finalized-old-id'));
  observations.push(await observe(secondId, 'v6-finalized-returned-id'));
} catch (error) {
  secondCreateError = String(error?.message || error).slice(0, 240);
}
console.log('POSTFINAL_RESULT', JSON.stringify({firstId, secondId,
  sameId:Boolean(secondId) && firstId === secondId, secondCreateError, observations}));
