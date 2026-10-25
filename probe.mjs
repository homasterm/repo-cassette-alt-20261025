import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `prefinalize-public-${process.env.GITHUB_RUN_ID}.json`;
const mime = '\u0085application/json';
const body = Buffer.from(JSON.stringify({marker: name}));
const made = await client.CreateArtifact({
  ...backend,
  name,
  version: 7,
  mimeType: StringValue.create({value: 'application/octet-stream'}),
});
if (!made.ok) throw new Error('create-not-ok');
await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
  blobHTTPHeaders: {blobContentType: mime},
});

const listed = await client.ListArtifacts({
  ...backend,
  nameFilter: StringValue.create({value: name}),
});
const rows = [];
for (const artifact of listed.artifacts) {
  const id = String(artifact.databaseId);
  const first = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${id}/zip`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'repo-cassette-prefinalize-public-probe',
      },
      redirect: 'manual',
    },
  );
  const location = first.headers.get('location');
  const final = location ? await fetch(location) : first;
  const bytes = Buffer.from(await final.arrayBuffer());
  const type = final.headers.get('content-type') || '';
  rows.push({
    id,
    firstStatus: first.status,
    finalStatus: final.status,
    typeCodePoints: Array.from(type, c => c.codePointAt(0)),
    bodyMatches: bytes.equals(body),
    size: bytes.length,
  });
}
console.log('PREFINALIZE_PUBLIC_RESULT', JSON.stringify({count: rows.length, rows}));
