import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `repo-cassette-sequential-${process.env.GITHUB_RUN_ID}`;
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'file:///proc/self/environ'},
  description: 'controlled',
  stargazers_count: 0,
}));

const first = await client.CreateArtifact({
  ...backend,
  name,
  version: 6,
  mimeType: StringValue.create({value: '\u0085application/json'}),
});
if (!first.ok) throw new Error('first CreateArtifact returned not ok');

let second;
let secondError = '';
try {
  second = await client.CreateArtifact({
    ...backend,
    name,
    version: 7,
    mimeType: StringValue.create({value: 'application/json'}),
  });
} catch (error) {
  secondError = String(error?.message || error).slice(0, 240);
}

if (!second?.ok) {
  console.log('SEQUENTIAL_RESULT', JSON.stringify({
    firstOk: first.ok,
    secondOk: false,
    secondError,
  }));
  process.exit(0);
}

for (const signedUrl of [first.signedUploadUrl, second.signedUploadUrl]) {
  await new BlobClient(signedUrl).getBlockBlobClient().uploadData(body, {
    blobHTTPHeaders: {blobContentType: 'application/json'},
  });
}
const finalized = await client.FinalizeArtifact({
  ...backend,
  name,
  size: String(body.length),
});
if (!finalized.ok) throw new Error('FinalizeArtifact returned not ok');

const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'repo-cassette-sequential-probe',
};
const apiUrl = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${finalized.artifactId}/zip`;
const initial = await fetch(apiUrl, {headers, redirect: 'manual'});
const location = initial.headers.get('location');
const final = location ? await fetch(location) : initial;
const finalBody = Buffer.from(await final.arrayBuffer());
const finalType = final.headers.get('content-type') || '';
console.log('SEQUENTIAL_RESULT', JSON.stringify({
  firstOk: first.ok,
  secondOk: second.ok,
  sameUploadUrl: first.signedUploadUrl === second.signedUploadUrl,
  artifactId: String(finalized.artifactId),
  initialStatus: initial.status,
  finalStatus: final.status,
  finalType,
  finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
  bodyMatches: finalBody.equals(body),
  bodyLength: finalBody.length,
}));
