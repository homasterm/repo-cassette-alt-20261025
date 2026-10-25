import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `internal-signed-${process.env.GITHUB_RUN_ID}.json`;
const mime = '\u0085application/json';
const body = Buffer.from(JSON.stringify({marker: name}));
const made = await client.CreateArtifact({
  ...backend,
  name,
  version: 7,
  mimeType: StringValue.create({value: 'application/octet-stream'}),
});
if (!made.ok) throw new Error('create-not-ok');
const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
await block.uploadData(body, {blobHTTPHeaders: {blobContentType: mime}});
const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
if (!done.ok) throw new Error('finalize-not-ok');
await block.uploadData(body, {blobHTTPHeaders: {blobContentType: mime}});

const signed = await client.GetSignedArtifactURL({...backend, name});
const parsed = new URL(signed.signedUrl);
const response = await fetch(signed.signedUrl);
const bytes = Buffer.from(await response.arrayBuffer());
const type = response.headers.get('content-type') || '';
console.log('INTERNAL_SIGNED_RESULT', JSON.stringify({
  artifactId: String(done.artifactId),
  status: response.status,
  typeCodePoints: Array.from(type, c => c.codePointAt(0)),
  bodyMatches: bytes.equals(body),
  size: bytes.length,
  responseParamNames: Array.from(new Set(parsed.searchParams.keys())).sort(),
  hasRsct: parsed.searchParams.has('rsct'),
}));
