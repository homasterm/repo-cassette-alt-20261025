import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient();
const backend = getBackendIdsFromToken();
const version = Number(process.env.ARTIFACT_VERSION || '6');
const name = `repo-cassette-v${version}-${process.env.GITHUB_RUN_ID}`;
const mimeType = '\u0085application/json';
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: { login: 'repo', avatar_url: 'file:///proc/self/environ' },
  description: 'controlled',
  stargazers_count: 0,
}));

const made = await client.CreateArtifact({
  ...backend,
  name,
  version,
  mimeType: StringValue.create({ value: mimeType }),
});
if (!made.ok) throw new Error('CreateArtifact returned not ok');
await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
  blobHTTPHeaders: { blobContentType: mimeType },
});
const finalized = await client.FinalizeArtifact({
  ...backend,
  name,
  size: String(body.length),
});
const artifactId = String(finalized.artifactId);

const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'repo-cassette-controlled-probe',
};
const apiUrl = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${artifactId}/zip`;
const first = await fetch(apiUrl, { headers, redirect: 'manual' });
const location = first.headers.get('location');
const final = location ? await fetch(location) : first;
const finalBody = Buffer.from(await final.arrayBuffer());
const finalType = final.headers.get('content-type') || '';
const result = {
  version,
  artifactId,
  firstStatus: first.status,
  firstType: first.headers.get('content-type'),
  hasLocation: Boolean(location),
  finalStatus: final.status,
  finalType,
  finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
  bodyMatches: finalBody.equals(body),
  bodyLength: finalBody.length,
  expectedLength: body.length,
};

const target = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/contents/probe-result.json`;
const saved = await fetch(target, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: `Record controlled artifact v${version} result`,
    content: Buffer.from(JSON.stringify(result, null, 2) + '\n').toString('base64'),
  }),
});
if (!saved.ok) throw new Error(`Saving result failed: ${saved.status}`);
console.log('RESULT_SAVED', JSON.stringify(result));
