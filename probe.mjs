import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'https://example.invalid/benign.png'},
  description: 'generic-json-name-marker',
  stargazers_count: 0,
}));
const name = `payload-${process.env.GITHUB_RUN_ID}.json`;
const made = await client.CreateArtifact({
  ...backend,
  name,
  version: 7,
  mimeType: StringValue.create({value: 'application/octet-stream'}),
});
if (!made.ok) throw new Error('create-not-ok');
await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
  blobHTTPHeaders: {blobContentType: '\u0085application/json'},
});
const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
if (!done.ok) throw new Error('finalize-not-ok');

const first = await fetch(
  `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`,
  {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'repo-cassette-generic-json-name-probe',
    },
    redirect: 'manual',
  },
);
const location = first.headers.get('location');
const final = location ? await fetch(location) : first;
const bytes = Buffer.from(await final.arrayBuffer());
const finalType = final.headers.get('content-type') || '';
console.log('GENERIC_JSON_NAME_RESULT', JSON.stringify({
  artifactId: String(done.artifactId),
  name,
  firstStatus: first.status,
  finalStatus: final.status,
  finalType,
  finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
  bodyMatches: bytes.equals(body),
  size: bytes.length,
}));
